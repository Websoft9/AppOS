package routes

import (
	_ "embed"
	"net/http"

	openapidocs "github.com/websoft9/appos/backend/docs/openapi"
	"github.com/pocketbase/pocketbase/core"
)

// swaggerUIHTML is the Swagger UI page. It loads the UI assets from the
// official CDN and points at /openapi/spec for the embedded spec file.
// No npm build step or binary bloat — just the YAML is embedded.
const swaggerUIHTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>AppOS API Docs</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({
      url: "/openapi/spec",
      dom_id: "#swagger-ui",
      presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset],
      layout: "BaseLayout",
      deepLinking: true,
    });
  </script>
</body>
</html>`

// registerOpenAPIRoutes mounts the Swagger UI and spec at /openapi.
//
//   GET /openapi      — Swagger UI (HTML, loads assets from CDN)
//   GET /openapi/spec — raw OpenAPI 3.0 YAML (embedded in binary)
//
// Both routes are public (no auth required) so tooling and CI can access
// the spec without a token.
func registerOpenAPIRoutes(se *core.ServeEvent) {
	se.Router.GET("/openapi", func(e *core.RequestEvent) error {
		e.Response.Header().Set("Content-Type", "text/html; charset=utf-8")
		e.Response.WriteHeader(http.StatusOK)
		_, _ = e.Response.Write([]byte(swaggerUIHTML))
		return nil
	})

	se.Router.GET("/openapi/spec", func(e *core.RequestEvent) error {
		e.Response.Header().Set("Content-Type", "application/yaml; charset=utf-8")
		e.Response.Header().Set("Access-Control-Allow-Origin", "*")
		e.Response.WriteHeader(http.StatusOK)
		_, _ = e.Response.Write(openapidocs.ExtAPISpec)
		return nil
	})
}
