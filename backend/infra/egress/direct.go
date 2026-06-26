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
		transport.TLSClientConfig = &tls.Config{InsecureSkipVerify: true}
	}
	return http.Client{Timeout: timeout, Transport: transport}
}