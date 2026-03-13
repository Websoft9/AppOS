package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Fix secrets ListRule and ViewRule so that:
//   - global scope secrets are visible to ANY authenticated user (not only the owner)
//   - user_private secrets remain visible only to the owner + superuser
//
// The previous migration erroneously applied owner-only access to all records,
// preventing cross-user secretRef binding for global secrets.
func init() {
	m.Register(func(app core.App) error {
		col, err := app.FindCollectionByNameOrId("secrets")
		if err != nil {
			return err
		}

		// Any authenticated user can list/view global secrets;
		// user_private secrets are restricted to their owner and superusers.
		anyAuthOrOwner := "@request.auth.id != '' && (scope = 'global' || created_by = @request.auth.id || @request.auth.collectionName = '_superusers')"
		col.ListRule = &anyAuthOrOwner
		col.ViewRule = &anyAuthOrOwner

		return app.Save(col)
	}, func(app core.App) error {
		col, err := app.FindCollectionByNameOrId("secrets")
		if err != nil {
			return nil
		}

		// Restore previous (overly restrictive) owner-only rule.
		ownerOrSuper := "created_by = @request.auth.id || @request.auth.collectionName = '_superusers'"
		col.ListRule = &ownerOrSuper
		col.ViewRule = &ownerOrSuper

		return app.Save(col)
	})
}
