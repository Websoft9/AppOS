package routes

import (
	"encoding/base64"
	"io"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/hook"
	"github.com/websoft9/appos/backend/infra/egress"
)

func registerSelfProxyIngress(se *core.ServeEvent) {
	se.Router.Bind(selfProxyMiddleware())
}

func selfProxyMiddleware() *hook.Handler[*core.RequestEvent] {
	return &hook.Handler[*core.RequestEvent]{
		Id:       "selfProxyIngress",
		Priority: -2000,
		Func: func(e *core.RequestEvent) error {
			if e == nil || e.Request == nil {
				return e.Next()
			}
			if !isSelfProxyRequest(e.Request) {
				return e.Next()
			}
			if err := handleSelfProxyRequest(e); err != nil {
				return err
			}
			return nil
		},
	}
}

func isSelfProxyRequest(r *http.Request) bool {
	if r == nil {
		return false
	}
	if strings.TrimSpace(r.Header.Get("Proxy-Authorization")) == "" {
		return false
	}
	if r.Method == http.MethodConnect {
		return true
	}
	return strings.TrimSpace(r.URL.Scheme) != "" && strings.TrimSpace(r.URL.Host) != ""
}

func handleSelfProxyRequest(e *core.RequestEvent) error {
	serverID, token, ok := proxyBasicAuth(e.Request.Header.Get("Proxy-Authorization"))
	serverID = strings.TrimSpace(serverID)
	if !ok || serverID == "" || strings.TrimSpace(token) == "" {
		return selfProxyUnauthorized(e)
	}
	if _, err := findMonitorServer(e.App, serverID); err != nil {
		return selfProxyUnauthorized(e)
	}
	expectedToken, err := egress.ReadSelfProxyToken(e.App, serverID)
	if err != nil || !egress.ConstantTimeTokenEqual(expectedToken, token) {
		return selfProxyUnauthorized(e)
	}
	if e.Request.Method == http.MethodConnect {
		return handleSelfProxyConnect(e)
	}
	return handleSelfProxyForward(e)
}

func selfProxyUnauthorized(e *core.RequestEvent) error {
	e.Response.Header().Set("Proxy-Authenticate", `Basic realm="AppOS self proxy"`)
	e.Response.WriteHeader(http.StatusProxyAuthRequired)
	_, _ = e.Response.Write([]byte("proxy authentication required\n"))
	return nil
}

func handleSelfProxyForward(e *core.RequestEvent) error {
	upstreamURL := e.Request.URL
	if upstreamURL == nil || strings.TrimSpace(upstreamURL.Scheme) == "" || strings.TrimSpace(upstreamURL.Host) == "" {
		return e.BadRequestError("invalid proxy target", nil)
	}
	upstreamReq, err := http.NewRequestWithContext(e.Request.Context(), e.Request.Method, upstreamURL.String(), e.Request.Body)
	if err != nil {
		return e.BadRequestError("invalid proxy request", err)
	}
	copyProxyRequestHeaders(upstreamReq.Header, e.Request.Header)
	clientPlan, err := egress.NewTunnelHTTPClientPlan(e.App, "remote_shell.tunnel_http", 30*time.Second, false)
	if err != nil {
		return e.InternalServerError("self proxy transport resolution failed", err)
	}
	logEgressWarnings(e, clientPlan.Decision.Warnings)
	resp, err := clientPlan.Client.Do(upstreamReq)
	if err != nil {
		return e.InternalServerError("self proxy upstream request failed", err)
	}
	defer resp.Body.Close()
	copyResponseHeaders(e.Response.Header(), resp.Header)
	e.Response.WriteHeader(resp.StatusCode)
	_, _ = io.Copy(e.Response, resp.Body)
	return nil
}

func handleSelfProxyConnect(e *core.RequestEvent) error {
	targetAddr := strings.TrimSpace(e.Request.Host)
	if targetAddr == "" && e.Request.URL != nil {
		targetAddr = strings.TrimSpace(e.Request.URL.Host)
	}
	if targetAddr == "" {
		return e.BadRequestError("missing CONNECT target", nil)
	}
	dialerPlan, err := egress.NewTunnelDialerPlan(e.App, "remote_shell.tunnel_dialer", 15*time.Second)
	if err != nil {
		return e.InternalServerError("self proxy dialer resolution failed", err)
	}
	logEgressWarnings(e, dialerPlan.Decision.Warnings)
	upstreamConn, err := dialerPlan.DialContext(e.Request.Context(), "tcp", targetAddr)
	if err != nil {
		return e.InternalServerError("self proxy CONNECT dial failed", err)
	}
	defer upstreamConn.Close()

	hijacker, ok := e.Response.(http.Hijacker)
	if !ok {
		return e.InternalServerError("self proxy CONNECT hijack unsupported", nil)
	}
	clientConn, rw, err := hijacker.Hijack()
	if err != nil {
		return e.InternalServerError("self proxy CONNECT hijack failed", err)
	}
	defer clientConn.Close()
	if _, err := io.WriteString(rw, "HTTP/1.1 200 Connection Established\r\n\r\n"); err != nil {
		return nil
	}
	if err := rw.Flush(); err != nil {
		return nil
	}

	errCh := make(chan error, 2)
	go proxyCopy(errCh, upstreamConn, clientConn)
	go proxyCopy(errCh, clientConn, upstreamConn)
	<-errCh
	return nil
}

func proxyCopy(errCh chan<- error, dst net.Conn, src net.Conn) {
	_, err := io.Copy(dst, src)
	if tcpConn, ok := dst.(*net.TCPConn); ok {
		_ = tcpConn.CloseWrite()
	}
	errCh <- err
}

func proxyBasicAuth(header string) (username string, password string, ok bool) {
	header = strings.TrimSpace(header)
	if header == "" || !strings.HasPrefix(strings.ToLower(header), "basic ") {
		return "", "", false
	}
	decoded, err := base64.StdEncoding.DecodeString(strings.TrimSpace(header[6:]))
	if err != nil {
		return "", "", false
	}
	parts := strings.SplitN(string(decoded), ":", 2)
	if len(parts) != 2 {
		return "", "", false
	}
	return parts[0], parts[1], true
}

func copyProxyRequestHeaders(dst http.Header, src http.Header) {
	for key, values := range src {
		switch http.CanonicalHeaderKey(key) {
		case "Proxy-Authorization", "Proxy-Connection", "Connection":
			continue
		}
		for _, value := range values {
			dst.Add(key, value)
		}
	}
}

func copyResponseHeaders(dst http.Header, src http.Header) {
	for key, values := range src {
		for _, value := range values {
			dst.Add(key, value)
		}
	}
}

func logEgressWarnings(e *core.RequestEvent, warnings []egress.Warning) {
	if e == nil || e.App == nil || len(warnings) == 0 {
		return
	}
	for _, warning := range warnings {
		if strings.TrimSpace(warning.Message) == "" {
			continue
		}
		e.App.Logger().Warn("self proxy egress warning", "code", string(warning.Code), "message", warning.Message)
	}
}
