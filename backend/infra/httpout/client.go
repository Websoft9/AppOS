package httpout

import (
	"context"
	"crypto/tls"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/proxy"
	netproxy "golang.org/x/net/proxy"
	"golang.org/x/net/http/httpproxy"
)

func NewPolicyClient(app core.App, policyKey string, timeout time.Duration, skipTLSVerify bool) (http.Client, error) {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	if skipTLSVerify {
		// #nosec G402 -- caller explicitly opts into skipping TLS verification for trusted/self-hosted endpoints.
		transport.TLSClientConfig = &tls.Config{InsecureSkipVerify: true}
	}
	directTransport := transport.Clone()
	if app == nil {
		return http.Client{Timeout: timeout, Transport: directTransport}, nil
	}
	env, err := proxy.ProxyEnvForConsumer(app, policyKey)
	if err != nil {
		return http.Client{}, err
	}
	if len(env) == 0 {
		return http.Client{Timeout: timeout, Transport: directTransport}, nil
	}
	proxyTransport := transport.Clone()
	if dialContext := socks5DialContextFromEnv(env); dialContext != nil {
		proxyTransport.Proxy = nil
		proxyTransport.DialContext = dialContext
	} else if proxyFunc := proxyFuncFromEnv(env); proxyFunc != nil {
		proxyTransport.Proxy = proxyFunc
	}
	return http.Client{Timeout: timeout, Transport: proxyTransport}, nil
}

func socks5DialContextFromEnv(proxyEnv map[string]string) func(ctx context.Context, network, address string) (net.Conn, error) {
	proxyAddress := firstNonEmptyString(
		proxyEnv["ALL_PROXY"],
		proxyEnv["all_proxy"],
		proxyEnv["HTTP_PROXY"],
		proxyEnv["http_proxy"],
		proxyEnv["HTTPS_PROXY"],
		proxyEnv["https_proxy"],
	)
	if proxyAddress == "" {
		return nil
	}
	proxyURL, err := url.Parse(proxyAddress)
	if err != nil {
		return nil
	}
	if proxyURL.Scheme != "socks5" && proxyURL.Scheme != "socks5h" {
		return nil
	}
	dialer, err := netproxy.FromURL(proxyURL, netproxy.Direct)
	if err != nil {
		return nil
	}
	return func(ctx context.Context, network, address string) (net.Conn, error) {
		return dialer.Dial(network, address)
	}
}

func proxyFuncFromEnv(proxyEnv map[string]string) func(*http.Request) (*url.URL, error) {
	if len(proxyEnv) == 0 {
		return http.ProxyFromEnvironment
	}
	httpProxy := firstNonEmptyString(proxyEnv["HTTP_PROXY"], proxyEnv["http_proxy"], proxyEnv["ALL_PROXY"], proxyEnv["all_proxy"])
	httpsProxy := firstNonEmptyString(proxyEnv["HTTPS_PROXY"], proxyEnv["https_proxy"], proxyEnv["ALL_PROXY"], proxyEnv["all_proxy"])
	noProxy := firstNonEmptyString(proxyEnv["NO_PROXY"], proxyEnv["no_proxy"])
	proxyFunc := (&httpproxy.Config{HTTPProxy: httpProxy, HTTPSProxy: httpsProxy, NoProxy: noProxy}).ProxyFunc()
	return func(req *http.Request) (*url.URL, error) {
		proxyURL, err := proxyFunc(req.URL)
		if err != nil || proxyURL == nil {
			return nil, err
		}
		return proxyURL, nil
	}
}

func firstNonEmptyString(values ...string) string {
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed != "" {
			return trimmed
		}
	}
	return ""
}