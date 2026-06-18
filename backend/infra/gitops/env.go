package gitops

import (
	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/proxy"
)

func ProxyEnv(app core.App) (map[string]string, error) {
	return proxy.ProxyEnvForConsumer(app, "git.general")
}