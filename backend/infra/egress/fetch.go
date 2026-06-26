package egress

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

func ValidateFetchURL(rawURL string) (*url.URL, error) {
	parsed, err := url.ParseRequestURI(rawURL)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return nil, fmt.Errorf("only http and https URLs are supported")
	}
	host := strings.ToLower(strings.TrimSpace(parsed.Hostname()))
	if host == "" {
		return nil, fmt.Errorf("request URL must include a host")
	}
	if host == "localhost" {
		return nil, fmt.Errorf("private/loopback URLs are not allowed")
	}
	if ip := net.ParseIP(host); ip != nil && isBlockedFetchIP(ip) {
		return nil, fmt.Errorf("private/loopback URLs are not allowed")
	}
	return parsed, nil
}

func NewFetchHTTPClient(app core.App, consumerKey string, timeout time.Duration, skipTLSVerify bool) (http.Client, error) {
	plan, err := NewFetchHTTPClientPlan(app, consumerKey, timeout, skipTLSVerify)
	if err != nil {
		return http.Client{}, err
	}
	return plan.Client, nil
}

func NewFetchHTTPClientPlan(app core.App, consumerKey string, timeout time.Duration, skipTLSVerify bool) (HTTPClientPlan, error) {
	plan, err := NewHTTPClientPlan(app, consumerKey, timeout, skipTLSVerify)
	if err != nil {
		return HTTPClientPlan{}, err
	}
	transport, ok := plan.Client.Transport.(*http.Transport)
	if !ok || transport == nil {
		transport = http.DefaultTransport.(*http.Transport).Clone()
	}
	transport = transport.Clone()
	applyFetchSafetyTransport(transport)
	plan.Client.Transport = &fetchValidatingRoundTripper{base: transport}
	plan.Client.CheckRedirect = fetchSafeRedirectPolicy(plan.Client.CheckRedirect)
	return plan, nil
}

type fetchValidatingRoundTripper struct {
	base http.RoundTripper
}

func (rt *fetchValidatingRoundTripper) RoundTrip(req *http.Request) (*http.Response, error) {
	if req == nil || req.URL == nil {
		return nil, fmt.Errorf("invalid request URL")
	}
	if err := validateFetchURL(req.Context(), req.URL); err != nil {
		return nil, err
	}
	return rt.base.RoundTrip(req)
}

func fetchSafeRedirectPolicy(next func(req *http.Request, via []*http.Request) error) func(req *http.Request, via []*http.Request) error {
	return func(req *http.Request, via []*http.Request) error {
		if req == nil || req.URL == nil {
			return fmt.Errorf("invalid redirect URL")
		}
		if err := validateFetchURL(req.Context(), req.URL); err != nil {
			return err
		}
		if len(via) >= 10 {
			return fmt.Errorf("stopped after too many redirects")
		}
		if next != nil {
			return next(req, via)
		}
		return nil
	}
}

func applyFetchSafetyTransport(transport *http.Transport) {
	if transport == nil {
		return
	}
	if transport.DialContext == nil {
		transport.DialContext = fetchSafeDirectDialContext(15 * time.Second)
		return
	}
	base := transport.DialContext
	transport.DialContext = func(ctx context.Context, network, addr string) (net.Conn, error) {
		if err := validateFetchDialTarget(ctx, addr); err != nil {
			return nil, err
		}
		return base(ctx, network, addr)
	}
}

func fetchSafeDirectDialContext(timeout time.Duration) func(context.Context, string, string) (net.Conn, error) {
	dialer := &net.Dialer{Timeout: timeout}
	return func(ctx context.Context, network, addr string) (net.Conn, error) {
		resolved, err := resolveFetchDialAddresses(ctx, addr)
		if err != nil {
			return nil, err
		}
		var lastErr error
		for _, target := range resolved {
			conn, dialErr := dialer.DialContext(ctx, network, target)
			if dialErr == nil {
				return conn, nil
			}
			lastErr = dialErr
		}
		if lastErr != nil {
			return nil, lastErr
		}
		return nil, fmt.Errorf("failed to connect to resolved host")
	}
}

func validateFetchURL(ctx context.Context, target *url.URL) error {
	if target == nil {
		return fmt.Errorf("invalid request URL")
	}
	if _, err := ValidateFetchURL(target.String()); err != nil {
		return err
	}
	host := strings.ToLower(strings.TrimSpace(target.Hostname()))
	if ip := net.ParseIP(host); ip != nil {
		return nil
	}
	if ctx == nil {
		ctx = context.Background()
	}
	addrs, err := net.DefaultResolver.LookupIP(ctx, "ip", host)
	if err != nil {
		return err
	}
	for _, ip := range addrs {
		if isBlockedFetchIP(ip) {
			return fmt.Errorf("private/loopback URLs are not allowed")
		}
	}
	return nil
}

func validateFetchDialTarget(ctx context.Context, addr string) error {
	_, err := resolveFetchDialAddresses(ctx, addr)
	return err
}

func resolveFetchDialAddresses(ctx context.Context, addr string) ([]string, error) {
	host, port, err := net.SplitHostPort(addr)
	if err != nil {
		return nil, err
	}
	host = strings.TrimSpace(host)
	if strings.EqualFold(host, "localhost") {
		return nil, fmt.Errorf("blocked private/loopback target")
	}
	if ip := net.ParseIP(host); ip != nil {
		if isBlockedFetchIP(ip) {
			return nil, fmt.Errorf("blocked private/loopback target")
		}
		return []string{net.JoinHostPort(ip.String(), port)}, nil
	}
	if ctx == nil {
		ctx = context.Background()
	}
	ips, err := net.DefaultResolver.LookupIP(ctx, "ip", host)
	if err != nil {
		return nil, err
	}
	resolved := make([]string, 0, len(ips))
	for _, ip := range ips {
		if isBlockedFetchIP(ip) {
			return nil, fmt.Errorf("blocked private/loopback target")
		}
		resolved = append(resolved, net.JoinHostPort(ip.String(), port))
	}
	if len(resolved) == 0 {
		return nil, fmt.Errorf("failed to resolve host")
	}
	return resolved, nil
}

func isBlockedFetchIP(ip net.IP) bool {
	if ip == nil {
		return false
	}
	return ip.IsLoopback() || ip.IsPrivate() || ip.IsUnspecified() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast()
}