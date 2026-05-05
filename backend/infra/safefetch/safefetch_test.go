package safefetch_test

import (
	"net"
	"testing"

	"github.com/websoft9/appos/backend/infra/safefetch"
)

// ─── IsBlockedIP ──────────────────────────────────────────────────────────────

func TestIsBlockedIP_Loopback(t *testing.T) {
	loopbacks := []string{"127.0.0.1", "127.255.255.255", "::1"}
	for _, addr := range loopbacks {
		ip := net.ParseIP(addr)
		if !safefetch.IsBlockedIP(ip) {
			t.Errorf("IsBlockedIP(%s) = false, want true (loopback)", addr)
		}
	}
}

func TestIsBlockedIP_PrivateRFC1918(t *testing.T) {
	private := []string{
		"10.0.0.1",
		"10.255.255.255",
		"172.16.0.1",
		"172.31.255.255",
		"192.168.0.1",
		"192.168.255.255",
	}
	for _, addr := range private {
		ip := net.ParseIP(addr)
		if !safefetch.IsBlockedIP(ip) {
			t.Errorf("IsBlockedIP(%s) = false, want true (private)", addr)
		}
	}
}

func TestIsBlockedIP_LinkLocal(t *testing.T) {
	linkLocal := []string{
		"169.254.0.1",
		"169.254.255.255",
		"fe80::1",
	}
	for _, addr := range linkLocal {
		ip := net.ParseIP(addr)
		if !safefetch.IsBlockedIP(ip) {
			t.Errorf("IsBlockedIP(%s) = false, want true (link-local)", addr)
		}
	}
}

func TestIsBlockedIP_Unspecified(t *testing.T) {
	unspecified := []string{"0.0.0.0", "::"}
	for _, addr := range unspecified {
		ip := net.ParseIP(addr)
		if !safefetch.IsBlockedIP(ip) {
			t.Errorf("IsBlockedIP(%s) = false, want true (unspecified)", addr)
		}
	}
}

func TestIsBlockedIP_PublicAddresses(t *testing.T) {
	public := []string{
		"8.8.8.8",
		"1.1.1.1",
		"93.184.216.34", // example.com
		"2001:4860:4860::8888",
	}
	for _, addr := range public {
		ip := net.ParseIP(addr)
		if safefetch.IsBlockedIP(ip) {
			t.Errorf("IsBlockedIP(%s) = true, want false (public)", addr)
		}
	}
}

func TestIsBlockedIP_Nil(t *testing.T) {
	if safefetch.IsBlockedIP(nil) {
		t.Error("IsBlockedIP(nil) = true, want false")
	}
}

// ─── ValidateURL ──────────────────────────────────────────────────────────────

func TestValidateURL_ValidHTTP(t *testing.T) {
	urls := []string{
		"http://example.com",
		"http://example.com/path",
		"https://example.com",
		"https://example.com:8443/api/v1",
		"http://93.184.216.34/resource",
	}
	for _, u := range urls {
		parsed, err := safefetch.ValidateURL(u)
		if err != nil {
			t.Errorf("ValidateURL(%q) unexpected error: %v", u, err)
			continue
		}
		if parsed == nil {
			t.Errorf("ValidateURL(%q) returned nil URL without error", u)
		}
	}
}

func TestValidateURL_RejectsLocalhostByName(t *testing.T) {
	_, err := safefetch.ValidateURL("http://localhost/path")
	if err == nil {
		t.Error("ValidateURL(localhost) should return an error")
	}
}

func TestValidateURL_RejectsPrivateIP(t *testing.T) {
	blocked := []string{
		"http://127.0.0.1/",
		"http://10.0.0.1/",
		"http://192.168.1.1/",
		"http://172.16.0.1/",
		"http://0.0.0.0/",
	}
	for _, u := range blocked {
		_, err := safefetch.ValidateURL(u)
		if err == nil {
			t.Errorf("ValidateURL(%q) should return an error (private/loopback IP)", u)
		}
	}
}

func TestValidateURL_RejectsBadSchemes(t *testing.T) {
	badSchemes := []string{
		"ftp://example.com/file",
		"file:///etc/passwd",
		"javascript:alert(1)",
		"ssh://user@host",
	}
	for _, u := range badSchemes {
		_, err := safefetch.ValidateURL(u)
		if err == nil {
			t.Errorf("ValidateURL(%q) should return an error (bad scheme)", u)
		}
	}
}

func TestValidateURL_RejectsMalformedURL(t *testing.T) {
	malformed := []string{
		"",
		"not-a-url",
		"://missing-scheme",
	}
	for _, u := range malformed {
		_, err := safefetch.ValidateURL(u)
		if err == nil {
			t.Errorf("ValidateURL(%q) should return an error (malformed)", u)
		}
	}
}

func TestValidateURL_ReturnsParsedURL(t *testing.T) {
	raw := "https://example.com/path?q=1"
	parsed, err := safefetch.ValidateURL(raw)
	if err != nil {
		t.Fatalf("ValidateURL(%q) unexpected error: %v", raw, err)
	}
	if parsed.Host != "example.com" {
		t.Errorf("parsed host = %q, want %q", parsed.Host, "example.com")
	}
	if parsed.Path != "/path" {
		t.Errorf("parsed path = %q, want %q", parsed.Path, "/path")
	}
}

// ─── NewClient ────────────────────────────────────────────────────────────────

func TestNewClient_NotNil(t *testing.T) {
	c := safefetch.NewClient()
	if c == nil {
		t.Fatal("NewClient() returned nil")
	}
}
