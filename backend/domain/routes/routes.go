// Package routes registers all custom API routes for AppOS.
//
// Route groups:
//   - /api/ext/proxy      — reverse proxy domain/SSL management
//   - /api/ext/system     — system metrics, file browser
//   - /api/ext/backup     — backup/restore operations
//   - /api/ext/resources  — Resource Store CRUD (Epic 8)
//   - /api/space         — User private space (Epic 9)
//   - /api/components     — component inventory and runtime service diagnostics (Epic 6)
//   - /api/catalog        — app catalog normalized read APIs
//   - /api/apps           — installed app inventory and lifecycle operations
//   - /api/actions        — lifecycle actions and execution logs
//   - /api/releases       — release inventory and app-scoped release views
//   - /api/exposures      — publication inventory and app-scoped exposure views
//   - /api/pipelines      — pipeline run inventory and detail views
//   - /api/topics         — Topic share management (authenticated + public share token)
//   - /api/ext/iac        — IaC file management (Epic 14, superuser-only)
//   - /api/tunnel         — tunnel setup and operations APIs (Epic 16)
//   - /api/servers        — Server catalog plus server-scoped Docker/ops/software routes (Epic 4, Epic 20)
//   - /api/software       — AppOS-local software inventory APIs
//   - /api/terminal       — Interactive terminal sessions: SSH, Docker, SFTP, local (Epic 20)
package routes

import (
	"github.com/hibiken/asynq"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
)

// asynqClient is set by main via SetAsynqClient after creating the worker.
// It is used by route handlers that need to enqueue background tasks.
var asynqClient *asynq.Client

// SetAsynqClient stores the Asynq client for use in async route handlers.
func SetAsynqClient(c *asynq.Client) {
	asynqClient = c
}

// Register mounts all custom route groups on the PocketBase router.
func Register(se *core.ServeEvent) {
	// OpenAPI docs — public, no auth required
	registerOpenAPIRoutes(se)

	// Setup routes (unauthenticated — only works when no superuser exists)
	registerSetupRoutes(se)

	// Auth helper routes (unauthenticated — email existence check, etc.)
	registerAuthRoutes(se)

	// Public space share routes (unauthenticated — share token validation and download)
	registerSpacePublicRoutes(se)

	// Public topic share routes (unauthenticated — view shared topic and post comments)
	registerTopicPublicRoutes(se)

	// Topic routes (authenticated share management + public share token)
	registerTopicRoutes(se)

	// Space routes (authenticated quota/fetch/share + public share/preview)
	registerSpaceRoutes(se)

	// Ext Settings API (superuser-only — registered directly on se.Router)
	RegisterSettings(se)

	// All /api/ext custom routes require authentication
	g := se.Router.Group("/api/ext")
	g.Bind(apis.RequireAuth())

	components := se.Router.Group("/api/components")
	components.Bind(apis.RequireAuth())

	deployments := se.Router.Group("/api")
	deployments.Bind(apis.RequireAuth())

	// Server catalog routes (ops, ports, systemd) — no terminal sessions
	servers := se.Router.Group("/api/servers")
	servers.Bind(apis.RequireAuth())

	// AppOS-local software inventory routes
	softwareGroup := se.Router.Group("/api/software")
	softwareGroup.Bind(apis.RequireAuth())

	// Terminal session routes (SSH PTY, Docker exec, SFTP, local)
	terminalGroup := se.Router.Group("/api/terminal")
	terminalGroup.Bind(wsTokenAuth())
	terminalGroup.Bind(apis.RequireSuperuserAuth())

	registerProxyRoutes(g)
	registerSystemRoutes(g)
	registerBackupRoutes(g)
	registerResourceRoutes(g)
	registerAIProviderRoutes(se)
	registerConnectorRoutes(se)
	registerInstanceRoutes(se)
	registerProviderAccountRoutes(se)
	registerUserRoutes(g)
	registerComponentsRoutes(components)
	registerCatalogRoutes(deployments)
	registerAppsRoutes(deployments)
	registerOperationRoutes(deployments)
	registerReleaseRoutes(deployments)
	registerExposureRoutes(deployments)
	registerIaCRoutes(g)
	registerServerRoutes(servers)
	registerDockerRoutes(servers)
	registerSoftwareRoutes(servers)
	registerLocalSoftwareRoutes(softwareGroup)
	registerTerminalRoutes(terminalGroup)
	registerTunnelRoutes(se)
	registerMonitorRoutes(se)
	registerSecretsRoutes(se)
	registerCertificatesRoutes(se)
	registerCronLogsRoute(se)
}
