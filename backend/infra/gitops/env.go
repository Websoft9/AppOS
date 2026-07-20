package gitops

import (
	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/infra/egress"
)

func ProxyEnv(app core.App) (map[string]string, error) {
	return egress.ProxyEnvForConsumer(app, "git.general")
}
