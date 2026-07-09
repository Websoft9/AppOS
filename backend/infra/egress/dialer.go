package egress

import (
	"bufio"
	"context"
	"crypto/tls"
	"encoding/base64"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"golang.org/x/net/http/httpproxy"
	netproxy "golang.org/x/net/proxy"
)

type DialContextFunc func(ctx context.Context, network, address string) (net.Conn, error)

func (f DialContextFunc) DialContext(ctx context.Context, network, address string) (net.Conn, error) {
	return f(ctx, network, address)
}

type DialerPlan struct {
	Decision    Decision            `json:"decision"`
	DialerMode  EffectiveDialerMode `json:"dialerMode"`
	DialContext DialContextFunc     `json:"-"`
}

func NewDialerPlan(app core.App, consumerKey string, timeout time.Duration) (DialerPlan, error) {
	directDialer := (&net.Dialer{Timeout: timeout}).DialContext
	plan := DialerPlan{DialContext: directDialer}
	if app == nil {
		return plan, nil
	}
	definition, mode, err := resolvePolicySelection(app, consumerKey, true)
	if err != nil {
		return DialerPlan{}, err
	}
	if err := ensureAdapter(definition, AdapterDialer); err != nil {
		return DialerPlan{}, err
	}
	plan.Decision = Decision{Definition: definition, ConsumerKey: definition.Key, Mode: mode, Capability: CapabilityNone}
	if mode == ModeDisabled {
		return plan, nil
	}
	capability, env, err := resolveCapability(app)
	if err != nil {
		return DialerPlan{}, err
	}
	plan.Decision.Capability = capability
	if len(env) == 0 {
		plan.Decision.Warnings = append(plan.Decision.Warnings, proxyUnavailableWarning(definition, capability))
		plan.Decision.Reason = "configured always, but no usable dialer proxy path is available"
		return plan, nil
	}
	plan.Decision.UseProxy = true
	plan.DialerMode = EffectiveDialerModeExternal
	plan.DialContext = buildDialContextFromEnv(env, timeout)
	return plan, nil
}

func NewTunnelDialerPlan(app core.App, consumerKey string, timeout time.Duration) (DialerPlan, error) {
	directDialer := (&net.Dialer{Timeout: timeout}).DialContext
	plan := DialerPlan{DialContext: directDialer, DialerMode: EffectiveDialerModeDirect}
	if app == nil {
		return plan, nil
	}
	decision, dialerMode, env, err := resolveTunnelDecision(app, consumerKey, AdapterDialer)
	if err != nil {
		return DialerPlan{}, err
	}
	plan.Decision = decision
	plan.DialerMode = dialerMode
	if dialerMode == EffectiveDialerModeExternal && len(env) > 0 {
		plan.DialContext = buildDialContextFromEnv(env, timeout)
	}
	return plan, nil
}

func buildDialContextFromEnv(proxyEnv map[string]string, timeout time.Duration) DialContextFunc {
	direct := (&net.Dialer{Timeout: timeout}).DialContext
	return func(ctx context.Context, network, address string) (net.Conn, error) {
		proxyURL, err := proxyURLForDialAddress(proxyEnv, address)
		if err != nil {
			return nil, err
		}
		if proxyURL == nil {
			return direct(ctx, network, address)
		}
		switch strings.ToLower(proxyURL.Scheme) {
		case "socks5", "socks5h":
			dialer, err := netproxy.FromURL(proxyURL, netproxy.Direct)
			if err != nil {
				return nil, err
			}
			return dialer.Dial(network, address)
		case "http", "https":
			return dialViaHTTPConnect(ctx, proxyEnv, proxyURL, address, timeout)
		default:
			return direct(ctx, network, address)
		}
	}
}

func proxyURLForDialAddress(proxyEnv map[string]string, address string) (*url.URL, error) {
	host, port, err := net.SplitHostPort(address)
	if err != nil {
		host = address
		port = "80"
	}
	if shouldBypassProxy(host, proxyEnv) {
		return nil, nil
	}
	if allProxy := firstNonEmptyString(proxyEnv["ALL_PROXY"], proxyEnv["all_proxy"]); allProxy != "" {
		return url.Parse(allProxy)
	}
	if httpsProxy := firstNonEmptyString(proxyEnv["HTTPS_PROXY"], proxyEnv["https_proxy"]); httpsProxy != "" {
		return url.Parse(httpsProxy)
	}
	if httpProxy := firstNonEmptyString(proxyEnv["HTTP_PROXY"], proxyEnv["http_proxy"]); httpProxy != "" {
		return url.Parse(httpProxy)
	}
	proxyFunc := (&httpproxy.Config{
		HTTPProxy:  firstNonEmptyString(proxyEnv["HTTP_PROXY"], proxyEnv["http_proxy"], proxyEnv["ALL_PROXY"], proxyEnv["all_proxy"]),
		HTTPSProxy: firstNonEmptyString(proxyEnv["HTTPS_PROXY"], proxyEnv["https_proxy"], proxyEnv["ALL_PROXY"], proxyEnv["all_proxy"]),
		NoProxy:    firstNonEmptyString(proxyEnv["NO_PROXY"], proxyEnv["no_proxy"]),
	}).ProxyFunc()
	return proxyFunc(&url.URL{Scheme: "http", Host: net.JoinHostPort(host, port)})
}

func shouldBypassProxy(host string, proxyEnv map[string]string) bool {
	proxyURL, err := (&httpproxy.Config{
		HTTPProxy:  "http://proxy.invalid",
		HTTPSProxy: "http://proxy.invalid",
		NoProxy:    firstNonEmptyString(proxyEnv["NO_PROXY"], proxyEnv["no_proxy"]),
	}).ProxyFunc()(&url.URL{Scheme: "https", Host: net.JoinHostPort(host, "443")})
	return err == nil && proxyURL == nil
}

func dialViaHTTPConnect(ctx context.Context, proxyEnv map[string]string, proxyURL *url.URL, address string, timeout time.Duration) (net.Conn, error) {
	dialer := &net.Dialer{Timeout: timeout}
	proxyAddr := canonicalProxyAddress(proxyURL)
	conn, err := dialer.DialContext(ctx, "tcp", proxyAddr)
	if err != nil {
		return nil, err
	}
	if strings.EqualFold(proxyURL.Scheme, "https") {
		tlsConn := tls.Client(conn, &tls.Config{MinVersion: tls.VersionTLS12, ServerName: proxyURL.Hostname()})
		if err := tlsConn.HandshakeContext(ctx); err != nil {
			_ = conn.Close()
			return nil, err
		}
		conn = tlsConn
	}
	req := &http.Request{Method: http.MethodConnect, URL: &url.URL{Opaque: address}, Host: address, Header: make(http.Header)}
	if header := proxyAuthorizationHeader(proxyEnv, proxyURL); header != "" {
		req.Header.Set("Proxy-Authorization", header)
	} else if proxyURL.User != nil {
		username := proxyURL.User.Username()
		password, _ := proxyURL.User.Password()
		token := base64.StdEncoding.EncodeToString([]byte(username + ":" + password))
		req.Header.Set("Proxy-Authorization", "Basic "+token)
	}
	if err := req.Write(conn); err != nil {
		_ = conn.Close()
		return nil, err
	}
	resp, err := http.ReadResponse(bufio.NewReader(conn), req)
	if err != nil {
		_ = conn.Close()
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		_ = conn.Close()
		return nil, fmt.Errorf("proxy CONNECT failed: %s", resp.Status)
	}
	return conn, nil
}

func proxyAuthorizationHeader(proxyEnv map[string]string, proxyURL *url.URL) string {
	if proxyURL == nil {
		return ""
	}
	if allProxy := firstNonEmptyString(proxyEnv["ALL_PROXY"], proxyEnv["all_proxy"]); allProxy != "" && allProxy == proxyURL.String() {
		return strings.TrimSpace(proxyEnv["APPOS_PROXY_AUTHORIZATION"])
	}
	if httpsProxy := firstNonEmptyString(proxyEnv["HTTPS_PROXY"], proxyEnv["https_proxy"]); httpsProxy != "" && httpsProxy == proxyURL.String() {
		return strings.TrimSpace(proxyEnv["APPOS_HTTPS_PROXY_AUTHORIZATION"])
	}
	if httpProxy := firstNonEmptyString(proxyEnv["HTTP_PROXY"], proxyEnv["http_proxy"]); httpProxy != "" && httpProxy == proxyURL.String() {
		return strings.TrimSpace(proxyEnv["APPOS_HTTP_PROXY_AUTHORIZATION"])
	}
	return strings.TrimSpace(proxyEnv["APPOS_PROXY_AUTHORIZATION"])
}

func canonicalProxyAddress(proxyURL *url.URL) string {
	host := strings.TrimSpace(proxyURL.Host)
	if _, _, err := net.SplitHostPort(host); err == nil {
		return host
	}
	if strings.EqualFold(proxyURL.Scheme, "https") {
		return net.JoinHostPort(host, "443")
	}
	return net.JoinHostPort(host, "80")
}
