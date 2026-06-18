package downloader

import (
	"net/http"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/infra/httpout"
)

func NewClient(app core.App, timeout time.Duration, skipTLSVerify bool) (http.Client, error) {
	return httpout.NewPolicyClient(app, "download.general", timeout, skipTLSVerify)
}