package routes

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
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
const aiAgentEmbeddedQueryParam = "embedded"
const aiAgentEmbeddedBootstrapMarker = "data-appos-ai-agent-embedded-bootstrap=\"1\""

const aiAgentEmbeddedBootstrapScript = `(function(){try{var url=new URL(window.location.href);if(url.searchParams.get("embedded")!=="1"){return}var prefix="` + aiAgentBasePath + `";var buildProxyURL=function(current){var proxied=new URL(window.location.origin+prefix+(current.pathname||"/"));proxied.search=current.search||"";proxied.hash=current.hash||"";proxied.searchParams.set("embedded","1");proxied.searchParams.delete("token");return proxied.pathname+proxied.search+proxied.hash};if(!url.pathname.startsWith(prefix)){return}var nextURL=new URL(url.href);nextURL.searchParams.delete("embedded");nextURL.searchParams.delete("token");nextURL.pathname=nextURL.pathname.slice(prefix.length)||"/";history.replaceState(history.state,"",nextURL.pathname+nextURL.search+nextURL.hash);var restoreProxyURL=function(){try{var current=new URL(window.location.href);history.replaceState(history.state,"",buildProxyURL(current))}catch(_err){}};window.addEventListener("beforeunload",restoreProxyURL);document.addEventListener("click",function(event){var target=event.target;if(!(target instanceof Element)){return}var anchor=target.closest("a[href]");if(!(anchor instanceof HTMLAnchorElement)){return}if(anchor.target&&anchor.target!=="_self"){return}var href=anchor.getAttribute("href");if(!href||href.charAt(0)==="#"){return}try{var linkURL=new URL(anchor.href,window.location.origin);if(linkURL.origin!==window.location.origin){return}if(!linkURL.pathname.startsWith(prefix)){return}linkURL.searchParams.set("embedded","1");linkURL.searchParams.delete("token");anchor.href=linkURL.pathname+linkURL.search+linkURL.hash}catch(_err){}},true)}catch(_err){}})();`

const aiAgentEmbeddedBootstrap = `<script data-appos-ai-agent-embedded-bootstrap="1">` + aiAgentEmbeddedBootstrapScript + `</script>`

var aiAgentEmbeddedBootstrapHash = func() string {
	sum := sha256.Sum256([]byte(aiAgentEmbeddedBootstrapScript))
	return "'sha256-" + base64.StdEncoding.EncodeToString(sum[:]) + "'"
}()

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
		embedded := isAIAgentEmbeddedRequest(e.Request)
		if loc := resp.Header.Get("Location"); loc != "" {
			resp.Header.Set("Location", rewriteAIAgentLocation(loc, embedded))
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
		rewritten := rewriteAIAgentResponseBody(string(body), contentType, embedded)
		resp.Body = io.NopCloser(bytes.NewReader([]byte(rewritten)))
		resp.ContentLength = int64(len(rewritten))
		resp.Header.Set("Content-Length", fmt.Sprintf("%d", len(rewritten)))
		if strings.Contains(contentType, "text/html") {
			if embedded {
				relaxAIAgentEmbeddedCSP(resp.Header)
			}
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

func rewriteAIAgentResponseBody(input, contentType string, embedded bool) string {
	rewritten := rewriteAIAgentContent(input)
	if !strings.Contains(contentType, "text/html") || !embedded {
		return rewritten
	}
	return injectAIAgentEmbeddedBootstrap(rewritten)
}

func rewriteAIAgentLocation(input string, embedded bool) string {
	rewritten := rewriteAIAgentContent(input)
	if !embedded {
		return rewritten
	}
	return appendEmbeddedQuery(rewritten)
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

func injectAIAgentEmbeddedBootstrap(input string) string {
	if input == "" || strings.Contains(input, aiAgentEmbeddedBootstrapMarker) {
		return input
	}
	lowerInput := strings.ToLower(input)
	if idx := strings.Index(lowerInput, "</head>"); idx >= 0 {
		return input[:idx] + aiAgentEmbeddedBootstrap + input[idx:]
	}
	if idx := strings.Index(lowerInput, "<script"); idx >= 0 {
		return input[:idx] + aiAgentEmbeddedBootstrap + input[idx:]
	}
	return aiAgentEmbeddedBootstrap + input
}

func appendEmbeddedQuery(input string) string {
	trimmed := strings.TrimSpace(input)
	if trimmed == "" {
		return input
	}
	parsed, err := url.Parse(trimmed)
	if err != nil {
		return input
	}
	if parsed.Host == "" && strings.HasPrefix(parsed.Path, "/") && !strings.HasPrefix(parsed.Path, aiAgentBasePath) {
		parsed.Path = aiAgentBasePath + parsed.Path
	}
	query := parsed.Query()
	query.Set(aiAgentEmbeddedQueryParam, "1")
	parsed.RawQuery = query.Encode()
	return parsed.String()
}

func relaxAIAgentEmbeddedCSP(headers http.Header) {
	if headers == nil {
		return
	}
	for _, key := range []string{"Content-Security-Policy", "Content-Security-Policy-Report-Only"} {
		value := strings.TrimSpace(headers.Get(key))
		if value == "" {
			continue
		}
		headers.Set(key, appendCSPDirectiveValue(value, "script-src", aiAgentEmbeddedBootstrapHash))
	}
}

func appendCSPDirectiveValue(policy, directive, value string) string {
	trimmedPolicy := strings.TrimSpace(policy)
	if trimmedPolicy == "" || strings.TrimSpace(value) == "" {
		return policy
	}
	parts := strings.Split(trimmedPolicy, ";")
	directivePrefix := directive + " "
	for idx, part := range parts {
		trimmedPart := strings.TrimSpace(part)
		if trimmedPart == directive || strings.HasPrefix(trimmedPart, directivePrefix) {
			if strings.Contains(trimmedPart, value) {
				return strings.Join(parts, "; ")
			}
			parts[idx] = strings.TrimSpace(trimmedPart + " " + value)
			return strings.Join(parts, "; ")
		}
	}
	parts = append(parts, directivePrefix+value)
	return strings.Join(parts, "; ")
}

func isAIAgentEmbeddedRequest(r *http.Request) bool {
	if r == nil {
		return false
	}
	return strings.TrimSpace(r.URL.Query().Get(aiAgentEmbeddedQueryParam)) == "1"
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
