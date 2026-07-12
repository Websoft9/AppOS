package routes

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/hook"
)

const aiAgentBasePath = "/api/ai/agent"
const aiAgentUpstreamURL = "http://127.0.0.1:4096"
const aiAgentTokenCookieName = "appos_ai_agent_token"

func registerAIAgentRoutes(se *core.ServeEvent) {
	group := se.Router.Group(aiAgentBasePath)
	group.Bind(aiAgentTokenAuth())
	group.Bind(apis.RequireSuperuserAuth())
	group.Any("", handleAIAgentProxy)
	group.Any("/{path...}", handleAIAgentProxy)
}

func aiAgentTokenAuth() *hook.Handler[*core.RequestEvent] {
	return &hook.Handler[*core.RequestEvent]{
		Id:       "aiAgentTokenAuth",
		Priority: -1019,
		Func: func(e *core.RequestEvent) error {
			if e.Auth != nil {
				return e.Next()
			}

			tok := strings.TrimSpace(e.Request.URL.Query().Get("token"))
			if tok == "" {
				if cookie, err := e.Request.Cookie(aiAgentTokenCookieName); err == nil {
					tok = strings.TrimSpace(cookie.Value)
				}
			}
			if tok == "" {
				return e.Next()
			}

			record, err := e.App.FindAuthRecordByToken(tok, core.TokenTypeAuth)
			if err == nil && record != nil {
				e.Auth = record
				if strings.TrimSpace(e.Request.URL.Query().Get("token")) != "" {
					http.SetCookie(e.Response, &http.Cookie{
						Name:     aiAgentTokenCookieName,
						Value:    tok,
						Path:     aiAgentBasePath,
						HttpOnly: true,
						SameSite: http.SameSiteLaxMode,
						Expires:  time.Now().Add(12 * time.Hour),
					})
				}
			}
			return e.Next()
		},
	}
}

func handleAIAgentProxy(e *core.RequestEvent) error {
	if e.Auth != nil {
		if tok := strings.TrimSpace(e.Request.URL.Query().Get("token")); tok != "" {
			http.SetCookie(e.Response, &http.Cookie{
				Name:     aiAgentTokenCookieName,
				Value:    tok,
				Path:     aiAgentBasePath,
				HttpOnly: true,
				SameSite: http.SameSiteLaxMode,
				Expires:  time.Now().Add(12 * time.Hour),
			})
		}
	}

	target, err := url.Parse(aiAgentUpstreamURL)
	if err != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{
			"error":   "ai_agent_proxy_invalid",
			"message": err.Error(),
		})
	}

	proxy := httputil.NewSingleHostReverseProxy(target)
	originalDirector := proxy.Director
	proxy.Director = func(r *http.Request) {
		originalDirector(r)
		r.Host = target.Host
		r.Header.Set("X-Forwarded-Prefix", aiAgentBasePath)
		r.Header.Set("X-Forwarded-Host", e.Request.Host)
		r.Header.Set("X-Forwarded-Proto", requestScheme(e.Request))
		pathValue := strings.TrimPrefix(strings.TrimSpace(e.Request.PathValue("path")), "/")
		upstreamPath := "/"
		if pathValue != "" {
			upstreamPath += pathValue
		}
		if e.Request.URL.Path == aiAgentBasePath {
			upstreamPath = "/"
		}
		r.URL.Path = upstreamPath
		r.URL.RawPath = upstreamPath
	}
	proxy.ModifyResponse = func(resp *http.Response) error {
		if loc := resp.Header.Get("Location"); loc != "" {
			resp.Header.Set("Location", rewriteAIAgentContent(loc))
		}
		contentType := strings.ToLower(strings.TrimSpace(resp.Header.Get("Content-Type")))
		if !strings.Contains(contentType, "text/html") && !strings.Contains(contentType, "javascript") && !strings.Contains(contentType, "json") {
			return nil
		}
		body, err := io.ReadAll(resp.Body)
		if err != nil {
			return err
		}
		_ = resp.Body.Close()
		rewritten := rewriteAIAgentContent(string(body))
		resp.Body = io.NopCloser(bytes.NewReader([]byte(rewritten)))
		resp.ContentLength = int64(len(rewritten))
		resp.Header.Set("Content-Length", fmt.Sprintf("%d", len(rewritten)))
		if strings.Contains(contentType, "text/html") {
			resp.Header.Set("Cache-Control", "no-cache, no-store, must-revalidate")
		}
		return nil
	}
	proxy.ErrorHandler = func(w http.ResponseWriter, r *http.Request, proxyErr error) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadGateway)
		_, _ = w.Write([]byte(fmt.Sprintf(`{"error":"ai_agent_proxy_failed","message":%q}`+"\n", proxyErr.Error())))
	}
	proxy.ServeHTTP(e.Response, e.Request)
	return nil
}

func rewriteAIAgentContent(input string) string {
	replacer := strings.NewReplacer(
		`href="/`, `href="`+aiAgentBasePath+`/`,
		`src="/`, `src="`+aiAgentBasePath+`/`,
		`action="/`, `action="`+aiAgentBasePath+`/`,
		`url:"/`, `url:"`+aiAgentBasePath+`/`,
		`url:'/`, `url:'`+aiAgentBasePath+`/`,
		`fetch("/`, `fetch("`+aiAgentBasePath+`/`,
		`fetch('/`, `fetch('`+aiAgentBasePath+`/`,
		`new URL("/`, `new URL("`+aiAgentBasePath+`/`,
		`new URL('/`, `new URL('`+aiAgentBasePath+`/`,
		`"/session`, `"`+aiAgentBasePath+`/session`,
		`"/event`, `"`+aiAgentBasePath+`/event`,
		`"/tui`, `"`+aiAgentBasePath+`/tui`,
		`"/file`, `"`+aiAgentBasePath+`/file`,
		`"/path`, `"`+aiAgentBasePath+`/path`,
		`"/project`, `"`+aiAgentBasePath+`/project`,
		`"/provider`, `"`+aiAgentBasePath+`/provider`,
		`"/config`, `"`+aiAgentBasePath+`/config`,
		`"/command`, `"`+aiAgentBasePath+`/command`,
		`"/auth`, `"`+aiAgentBasePath+`/auth`,
		`"/agent`, `"`+aiAgentBasePath+`/agent`,
		`"/formatter`, `"`+aiAgentBasePath+`/formatter`,
		`"/lsp`, `"`+aiAgentBasePath+`/lsp`,
		`"/mcp`, `"`+aiAgentBasePath+`/mcp`,
		`"/experimental`, `"`+aiAgentBasePath+`/experimental`,
		`"/global`, `"`+aiAgentBasePath+`/global`,
		`"/doc`, `"`+aiAgentBasePath+`/doc`,
	)
	return replacer.Replace(input)
}

func requestScheme(r *http.Request) string {
	if r == nil {
		return "http"
	}
	if proto := strings.TrimSpace(r.Header.Get("X-Forwarded-Proto")); proto != "" {
		return proto
	}
	if r.TLS != nil {
		return "https"
	}
	return "http"
}
