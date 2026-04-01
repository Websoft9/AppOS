package routes

import (
	"net/http"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/certs"
)

func registerCertificatesRoutes(se *core.ServeEvent) {
	g := se.Router.Group("/api/certificates")

	g.GET("/templates", func(e *core.RequestEvent) error {
		return e.JSON(http.StatusOK, certs.Templates())
	}).Bind(apis.RequireAuth())

	certs.RegisterGenerateRoutes(g)
}
