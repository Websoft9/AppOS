package routes

import (
	"github.com/pocketbase/pocketbase/core"
	"strings"
	"time"

	servers "github.com/websoft9/appos/backend/domain/resource/servers"
)

// resolveApposHost returns the public host name of the appos instance.
// It is derived from the HTTP request (browsers always call the real host),
// stripping the port for the SSH :2222 connection.
func resolveApposHost(e *core.RequestEvent) string {
	host := e.Request.Host
	if host == "" {
		host = e.Request.Header.Get("X-Forwarded-Host")
	}
	// Strip port if present (e.g. "appos.example.com:8090" → "appos.example.com").
	if idx := strings.LastIndex(host, ":"); idx >= 0 {
		// Only strip if the part after ":" looks like a port (all digits), not IPv6.
		if !strings.Contains(host[:idx], "]") {
			host = host[:idx]
		}
	}
	if host == "" {
		host = "appos-host"
	}
	return host
}

func tunnelPauseUntil(server *core.Record) time.Time {
	return servers.TunnelRuntimeFromRecord(server).PauseUntil
}
