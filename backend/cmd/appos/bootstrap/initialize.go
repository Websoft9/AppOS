package bootstrap

import (
	"database/sql"
	"errors"
	"fmt"
	"os"
	"strings"

	"github.com/hibiken/asynq"
	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/certs"
	"github.com/websoft9/appos/backend/domain/runtimecfg"
	"github.com/websoft9/appos/backend/domain/runtimepaths"
	"github.com/websoft9/appos/backend/domain/secrets"
	appschema "github.com/websoft9/appos/backend/infra/schema"
)

type InitializationState struct {
	RuntimeKeyWarning   string
	RuntimeKeyGenerated bool
}

func Initialize(app *pocketbase.PocketBase, cfg runtimecfg.Config, asynqClient *asynq.Client) (InitializationState, error) {
	state, err := initializeRuntime(cfg)
	if err != nil {
		return InitializationState{}, err
	}

	Register(app, asynqClient)
	app.OnServe().BindFunc(func(se *core.ServeEvent) error {
		if err := appschema.EnsureAllCollections(se.App); err != nil {
			return err
		}
		return se.Next()
	})
	app.OnServe().BindFunc(func(se *core.ServeEvent) error {
		if err := ensureConfiguredSuperuser(se.App, cfg); err != nil {
			return err
		}
		return se.Next()
	})

	return state, nil
}

func initializeRuntime(cfg runtimecfg.Config) (InitializationState, error) {
	secretDataDir := strings.TrimSpace(cfg.DataDir)
	if secretDataDir == "" {
		secretDataDir = strings.TrimSpace(os.Getenv("DATA_DIR"))
	}
	if secretDataDir == "" {
		secretDataDir = runtimepaths.DataRoot()
	}

	warning, generated, err := secrets.EnsureRuntimeKey(secretDataDir)
	if err != nil {
		return InitializationState{}, fmt.Errorf("secrets runtime key init failed: %w", err)
	}
	if err := secrets.LoadKeyFromEnv(); err != nil {
		return InitializationState{}, fmt.Errorf("secrets init failed: %w", err)
	}
	if err := secrets.LoadTemplatesFromDefaultPath(); err != nil {
		return InitializationState{}, fmt.Errorf("secrets templates init failed: %w", err)
	}
	if err := certs.LoadTemplatesFromDefaultPath(); err != nil {
		return InitializationState{}, fmt.Errorf("certificate templates init failed: %w", err)
	}

	return InitializationState{
		RuntimeKeyWarning:   warning,
		RuntimeKeyGenerated: generated,
	}, nil
}

func ensureConfiguredSuperuser(app core.App, cfg runtimecfg.Config) error {
	if strings.ToLower(strings.TrimSpace(cfg.InitMode)) != runtimecfg.DefaultInitMode {
		return nil
	}
	if strings.TrimSpace(cfg.SuperuserEmail) == "" || cfg.SuperuserPassword == "" {
		return nil
	}

	collection, err := app.FindCollectionByNameOrId(core.CollectionNameSuperusers)
	if err != nil {
		return fmt.Errorf("find superusers collection: %w", err)
	}

	record, err := app.FindAuthRecordByEmail(collection, cfg.SuperuserEmail)
	if err != nil {
		if !errors.Is(err, sql.ErrNoRows) {
			return fmt.Errorf("find configured superuser %s: %w", cfg.SuperuserEmail, err)
		}
		record = core.NewRecord(collection)
	}
	record.Set("email", cfg.SuperuserEmail)
	record.SetPassword(cfg.SuperuserPassword)
	if err := app.Save(record); err != nil {
		return fmt.Errorf("save configured superuser %s: %w", cfg.SuperuserEmail, err)
	}
	return nil
}
