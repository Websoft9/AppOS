// Package cronutil provides a reusable structured logging wrapper for
// AppOS-maintained PocketBase cron job handlers.
//
// Usage:
//
//	app.Cron().MustAdd("my_job", "0 * * * *", cronutil.Wrap(app, "my_job", func() {
//	    // business logic
//	}))
package cronutil

import (
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/pocketbase/pocketbase/core"
)

// Wrap returns a cron handler function that emits structured execution logs into
// PocketBase _logs around the given fn.
//
// Log contract (all phases emit these fields):
//   - type:       "cron"
//   - component:  "system_cron"
//   - job_id:     jobID
//   - run_id:     unique UUID per execution
//   - phase:      "start" | "success" | "error"
//   - trigger:    "scheduled"  (distinguishing manual is not guaranteed in v1)
//
// Terminal phases additionally emit:
//   - duration_ms: elapsed ms
//   - error:       (error phase only) machine-readable error summary
//
// If fn panics, Wrap writes an error log and re-panics to preserve default
// PocketBase cron behavior.
func Wrap(app core.App, jobID string, fn func()) func() {
	return func() {
		runID := uuid.New().String()
		start := time.Now()

		app.Logger().Info("cron started",
			slog.String("type", "cron"),
			slog.String("component", "system_cron"),
			slog.String("job_id", jobID),
			slog.String("run_id", runID),
			slog.String("phase", "start"),
			slog.String("trigger", "scheduled"),
		)

		// Recover from panics: write an error log then re-panic.
		defer func() {
			if r := recover(); r != nil {
				durMs := time.Since(start).Milliseconds()
				app.Logger().Error("cron failed",
					slog.String("type", "cron"),
					slog.String("component", "system_cron"),
					slog.String("job_id", jobID),
					slog.String("run_id", runID),
					slog.String("phase", "error"),
					slog.String("trigger", "scheduled"),
					slog.Int64("duration_ms", durMs),
					slog.Any("error", fmt.Sprintf("%v", r)),
				)
				panic(r)
			}
		}()

		fn()

		durMs := time.Since(start).Milliseconds()
		app.Logger().Info("cron finished",
			slog.String("type", "cron"),
			slog.String("component", "system_cron"),
			slog.String("job_id", jobID),
			slog.String("run_id", runID),
			slog.String("phase", "success"),
			slog.String("trigger", "scheduled"),
			slog.Int64("duration_ms", durMs),
		)
	}
}
