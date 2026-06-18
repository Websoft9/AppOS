package egress

import (
	"net/http"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

func NewPolicyClient(app core.App, policyKey string, timeout time.Duration, skipTLSVerify bool) (http.Client, error) {
	return NewHTTPClient(app, policyKey, timeout, skipTLSVerify)
}
