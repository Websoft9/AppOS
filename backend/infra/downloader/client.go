package downloader

import (
	"net/http"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/infra/egress"
)

func NewClient(app core.App, timeout time.Duration, skipTLSVerify bool) (http.Client, error) {
	return egress.NewPolicyClient(app, "download.general", timeout, skipTLSVerify)
}
