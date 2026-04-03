// Package safefetch provides an SSRF-safe HTTP client and URL validation
// utilities for fetching remote resources.
//
// All functions guard against private/loopback/link-local address access at
// the URL-parse, DNS-resolution, connect, and redirect layers.
package safefetch

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// ValidateURL validates that rawURL is a safe http/https URL with no
// private/loopback host. Returns (parsed URL, nil) on success.
func ValidateURL(rawURL string) (*url.URL, error) {
	parsed, err := url.ParseRequestURI(rawURL)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return nil, fmt.Errorf("only http and https URLs are supported")
	}

	host := strings.ToLower(parsed.Hostname())
	if host == "localhost" {
		return nil, fmt.Errorf("private/loopback URLs are not allowed")
	}
	if ip := net.ParseIP(host); ip != nil && IsBlockedIP(ip) {
		return nil, fmt.Errorf("private/loopback URLs are not allowed")
	}
	return parsed, nil
}

// IsBlockedIP reports whether ip is a private, loopback, or link-local address
// that must not be reachable via a fetch endpoint (SSRF guard).
func IsBlockedIP(ip net.IP) bool {
	if ip == nil {
		return false
	}
	return ip.IsLoopback() || ip.IsPrivate() || ip.IsUnspecified() ||
		ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast()
}

// NewClient returns an http.Client that blocks connections to private/loopback
// addresses at both the DNS-resolution and redirect layers.
func NewClient() *http.Client {
	dialer := &net.Dialer{Timeout: 15 * time.Second}

	transport := &http.Transport{
		DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
			host, port, err := net.SplitHostPort(addr)
			if err != nil {
				return nil, err
			}
			host = strings.TrimSpace(host)

			if strings.EqualFold(host, "localhost") {
				return nil, fmt.Errorf("blocked private/loopback target")
			}

			if ip := net.ParseIP(host); ip != nil {
				if IsBlockedIP(ip) {
					return nil, fmt.Errorf("blocked private/loopback target")
				}
				return dialer.DialContext(ctx, network, net.JoinHostPort(ip.String(), port))
			}

			ips, err := net.DefaultResolver.LookupIP(ctx, "ip", host)
			if err != nil {
				return nil, err
			}

			for _, ip := range ips {
				if IsBlockedIP(ip) {
					return nil, fmt.Errorf("blocked private/loopback target")
				}
			}

			for _, ip := range ips {
				if conn, dialErr := dialer.DialContext(ctx, network, net.JoinHostPort(ip.String(), port)); dialErr == nil {
					return conn, nil
				}
			}

			return nil, fmt.Errorf("failed to connect to resolved host")
		},
	}

	return &http.Client{
		Transport: transport,
		Timeout:   180 * time.Second,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if req.URL == nil {
				return fmt.Errorf("invalid redirect URL")
			}
			if req.URL.Scheme != "http" && req.URL.Scheme != "https" {
				return fmt.Errorf("only http and https URLs are supported")
			}
			host := strings.ToLower(req.URL.Hostname())
			if host == "localhost" {
				return fmt.Errorf("blocked private/loopback redirect")
			}
			if ip := net.ParseIP(host); ip != nil && IsBlockedIP(ip) {
				return fmt.Errorf("blocked private/loopback redirect")
			}
			if len(via) >= 10 {
				return fmt.Errorf("stopped after too many redirects")
			}
			return nil
		},
	}
}
