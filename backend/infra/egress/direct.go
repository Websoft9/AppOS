package egress

import (
	"crypto/tls"
	"net/http"
	"time"
)

func NewDirectHTTPClient(timeout time.Duration, skipTLSVerify bool) http.Client {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = nil
	if skipTLSVerify {
		transport.TLSClientConfig = newSkipVerifyTLSConfig()
	}
	return http.Client{Timeout: timeout, Transport: transport}
}

func newSkipVerifyTLSConfig() *tls.Config {
	// #nosec G402 -- some connectors explicitly require bypassing CA verification; callers opt in via skipTLSVerify.
	return &tls.Config{MinVersion: tls.VersionTLS12, InsecureSkipVerify: true}
}
