package routes

import (
	"net/http"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/router"
)

// registerBackupRoutes registers backup/restore routes.
// All backup routes require superuser authentication.
//
// Endpoints:
//
//	POST /api/appos/backup/create   — create a new backup
//	POST /api/appos/backup/restore  — restore from a backup
//	GET  /api/appos/backup/list     — list available backups
func registerBackupRoutes(g *router.RouterGroup[*core.RequestEvent]) {
	backup := g.Group("/backup")
	backup.Bind(apis.RequireSuperuserAuth())

	backup.POST("/create", handleBackupCreate)
	backup.POST("/restore", handleBackupRestore)
	backup.GET("/list", handleBackupList)
}

func handleBackupCreate(e *core.RequestEvent) error {
	// TODO: enqueue backup creation task (tar + encrypt)
	return e.JSON(http.StatusOK, map[string]any{
		"message": "not implemented",
	})
}

func handleBackupRestore(e *core.RequestEvent) error {
	// TODO: enqueue backup restore task
	return e.JSON(http.StatusOK, map[string]any{
		"message": "not implemented",
	})
}

func handleBackupList(e *core.RequestEvent) error {
	// TODO: list available backups from storage
	return e.JSON(http.StatusOK, map[string]any{
		"message": "not implemented",
	})
}
