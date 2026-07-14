package routes

import (
	"net/http"
	"strings"
	"testing"
)

func TestRewriteAIAgentResponseBodyInjectsEmbeddedBootstrapForHTML(t *testing.T) {
	html := `<html><head><title>OpenCode</title></head><body><script src="/assets/index.js"></script></body></html>`

	rewritten := rewriteAIAgentResponseBody(html, "text/html; charset=utf-8", true)

	if !strings.Contains(rewritten, aiAgentEmbeddedBootstrapMarker) {
		t.Fatalf("expected embedded bootstrap marker in rewritten html, got %s", rewritten)
	}
	if !strings.Contains(rewritten, `src="`+aiAgentBasePath+`/assets/index.js"`) {
		t.Fatalf("expected asset path rewrite in rewritten html, got %s", rewritten)
	}
	if strings.Count(rewritten, aiAgentEmbeddedBootstrapMarker) != 1 {
		t.Fatalf("expected bootstrap injected once, got %d occurrences", strings.Count(rewritten, aiAgentEmbeddedBootstrapMarker))
	}
}

func TestRewriteAIAgentResponseBodyLeavesNonEmbeddedHTMLWithoutBootstrap(t *testing.T) {
	html := `<html><head></head><body><script src="/assets/index.js"></script></body></html>`

	rewritten := rewriteAIAgentResponseBody(html, "text/html", false)

	if strings.Contains(rewritten, aiAgentEmbeddedBootstrapMarker) {
		t.Fatalf("expected non-embedded html to skip bootstrap, got %s", rewritten)
	}
	if !strings.Contains(rewritten, `src="`+aiAgentBasePath+`/assets/index.js"`) {
		t.Fatalf("expected asset path rewrite in rewritten html, got %s", rewritten)
	}
}

func TestRewriteAIAgentResponseBodySkipsBootstrapForNonHTML(t *testing.T) {
	body := `fetch("/")`

	rewritten := rewriteAIAgentResponseBody(body, "application/javascript", true)

	if strings.Contains(rewritten, aiAgentEmbeddedBootstrapMarker) {
		t.Fatalf("expected non-html body to skip bootstrap, got %s", rewritten)
	}
	if rewritten != `fetch("`+aiAgentBasePath+`/")` {
		t.Fatalf("expected javascript body rewrite, got %s", rewritten)
	}
}

func TestRewriteAIAgentLocationPreservesEmbeddedQuery(t *testing.T) {
	location := "/login?next=%2F"

	rewritten := rewriteAIAgentLocation(location, true)

	if rewritten != aiAgentBasePath+`/login?embedded=1&next=%2F` {
		t.Fatalf("expected embedded query preserved on rewritten location, got %s", rewritten)
	}
}

func TestAppendEmbeddedQueryPreservesExistingQuery(t *testing.T) {
	rewritten := appendEmbeddedQuery(aiAgentBasePath + "/project?foo=bar")

	if rewritten != aiAgentBasePath+`/project?embedded=1&foo=bar` && rewritten != aiAgentBasePath+`/project?foo=bar&embedded=1` {
		t.Fatalf("expected embedded query appended, got %s", rewritten)
	}
	if strings.Count(rewritten, "embedded=1") != 1 {
		t.Fatalf("expected single embedded query, got %s", rewritten)
	}
}

func TestInjectAIAgentEmbeddedBootstrapFallsBackBeforeScriptTag(t *testing.T) {
	html := `<html><body><script src="/assets/index.js"></script></body></html>`

	rewritten := injectAIAgentEmbeddedBootstrap(html)

	bootstrapIdx := strings.Index(rewritten, aiAgentEmbeddedBootstrapMarker)
	scriptIdx := strings.Index(rewritten, `<script src="/assets/index.js"></script>`)
	if bootstrapIdx < 0 {
		t.Fatalf("expected bootstrap marker in rewritten html, got %s", rewritten)
	}
	if scriptIdx < 0 {
		t.Fatalf("expected original script tag in rewritten html, got %s", rewritten)
	}
	if bootstrapIdx > scriptIdx {
		t.Fatalf("expected bootstrap before first script tag, got %s", rewritten)
	}
}

func TestRelaxAIAgentEmbeddedCSPAppendsBootstrapHash(t *testing.T) {
	headers := make(http.Header)
	headers.Set("Content-Security-Policy", "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'")

	relaxAIAgentEmbeddedCSP(headers)

	policy := headers.Get("Content-Security-Policy")
	if !strings.Contains(policy, aiAgentEmbeddedBootstrapHash) {
		t.Fatalf("expected CSP to include embedded bootstrap hash, got %s", policy)
	}
	if strings.Count(policy, aiAgentEmbeddedBootstrapHash) != 1 {
		t.Fatalf("expected bootstrap hash once, got %s", policy)
	}
}

func TestAppendCSPDirectiveValueAddsDirectiveWhenMissing(t *testing.T) {
	policy := appendCSPDirectiveValue("default-src 'self'", "script-src", aiAgentEmbeddedBootstrapHash)

	if !strings.Contains(policy, "script-src "+aiAgentEmbeddedBootstrapHash) {
		t.Fatalf("expected missing directive to be appended, got %s", policy)
	}
}
