package service

import (
	"context"
	"errors"
	"strings"
	"testing"
)

type fakeManagedCronRepository struct {
	loadDoc      ManagedCronRegistryDocument
	loadErr      error
	writeOutput  string
	writeErr     error
	writtenDoc   ManagedCronRegistryDocument
	writeInvoked bool
}

func (f *fakeManagedCronRepository) Load(context.Context) (ManagedCronRegistryDocument, error) {
	return f.loadDoc, f.loadErr
}

func (f *fakeManagedCronRepository) Write(_ context.Context, doc ManagedCronRegistryDocument) (string, error) {
	f.writeInvoked = true
	f.writtenDoc = doc
	return f.writeOutput, f.writeErr
}

func TestNewManagedCronJobNormalizesFields(t *testing.T) {
	job, err := NewManagedCronJob("  nightly-backup  ", "0   2  * * *", "  /opt/bin/backup.sh  ", true, true)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if job.Name != "nightly-backup" {
		t.Fatalf("expected trimmed name, got %q", job.Name)
	}
	if job.Schedule != "0 2 * * *" {
		t.Fatalf("expected normalized schedule, got %q", job.Schedule)
	}
	if job.Command != "/opt/bin/backup.sh" {
		t.Fatalf("expected trimmed command, got %q", job.Command)
	}
	if !job.Enabled || !job.SingleRunOnly || job.Source != "managed" {
		t.Fatalf("unexpected job metadata: %+v", job)
	}
}

func TestNewManagedCronJobRejectsInvalidInput(t *testing.T) {
	if _, err := NewManagedCronJob("", "0 2 * * *", "/opt/bin/backup.sh", true, false); err == nil {
		t.Fatal("expected empty name to fail")
	}
	if _, err := NewManagedCronJob("backup", "@daily", "/opt/bin/backup.sh", true, false); err == nil {
		t.Fatal("expected invalid schedule to fail")
	}
	if _, err := NewManagedCronJob("backup", "0 2 * * *", "   ", true, false); err == nil {
		t.Fatal("expected empty command to fail")
	}
	if _, err := NewManagedCronJob("backup", "0 2 * * *", "echo ok\nrm -rf /", true, false); err == nil {
		t.Fatal("expected multiline command to fail")
	}
}

func TestManagedCronServiceCreateAppendsManagedJob(t *testing.T) {
	repo := &fakeManagedCronRepository{writeOutput: "ok"}
	svc := ManagedCronService{Repository: repo}

	job, err := NewManagedCronJob("nightly-backup", "0 2 * * *", "/opt/bin/backup.sh", true, false)
	if err != nil {
		t.Fatalf("build job: %v", err)
	}

	created, output, err := svc.Create(context.Background(), job)
	if err != nil {
		t.Fatalf("expected create success, got %v", err)
	}
	if output != "ok" {
		t.Fatalf("expected write output ok, got %q", output)
	}
	if created.EntryID == "" {
		t.Fatal("expected created job to have an entry id")
	}
	if !repo.writeInvoked {
		t.Fatal("expected repository write to be called")
	}
	if len(repo.writtenDoc.Jobs) != 1 {
		t.Fatalf("expected one job in registry, got %+v", repo.writtenDoc.Jobs)
	}
	if repo.writtenDoc.Jobs[0].Command != "/opt/bin/backup.sh" {
		t.Fatalf("expected persisted command, got %+v", repo.writtenDoc.Jobs[0])
	}
	if repo.writtenDoc.Jobs[0].Source != "managed" {
		t.Fatalf("expected managed source, got %+v", repo.writtenDoc.Jobs[0])
	}
}

func TestManagedCronServiceToggleAndDelete(t *testing.T) {
	repo := &fakeManagedCronRepository{
		loadDoc: ManagedCronRegistryDocument{Jobs: []ManagedCronJob{{
			EntryID:  "cron_alpha",
			Name:     "backup",
			Schedule: "0 2 * * *",
			Command:  "/opt/bin/backup.sh",
			Enabled:  true,
			Source:   "managed",
		}}},
		writeOutput: "ok",
	}
	svc := ManagedCronService{Repository: repo}

	toggled, output, err := svc.Toggle(context.Background(), "cron_alpha", false)
	if err != nil {
		t.Fatalf("toggle failed: %v", err)
	}
	if output != "ok" || toggled.Enabled {
		t.Fatalf("unexpected toggle result: output=%q job=%+v", output, toggled)
	}
	if repo.writtenDoc.Jobs[0].Enabled {
		t.Fatalf("expected disabled job after toggle, got %+v", repo.writtenDoc.Jobs[0])
	}

	deleteRepo := &fakeManagedCronRepository{loadDoc: repo.writtenDoc, writeOutput: "deleted"}
	deleteSvc := ManagedCronService{Repository: deleteRepo}
	deleteOutput, err := deleteSvc.Delete(context.Background(), "cron_alpha")
	if err != nil {
		t.Fatalf("delete failed: %v", err)
	}
	if deleteOutput != "deleted" {
		t.Fatalf("expected delete output, got %q", deleteOutput)
	}
	if len(deleteRepo.writtenDoc.Jobs) != 0 {
		t.Fatalf("expected registry job removed, got %+v", deleteRepo.writtenDoc.Jobs)
	}
}

func TestManagedCronServiceUpdateMissingReturnsNotFound(t *testing.T) {
	repo := &fakeManagedCronRepository{loadDoc: ManagedCronRegistryDocument{}}
	svc := ManagedCronService{Repository: repo}

	job, err := NewManagedCronJob("backup", "0 2 * * *", "/opt/bin/backup.sh", true, false)
	if err != nil {
		t.Fatalf("build job: %v", err)
	}
	job.EntryID = "cron_missing"

	_, _, err = svc.Update(context.Background(), job)
	if !errors.Is(err, ErrManagedCronNotFound) {
		t.Fatalf("expected ErrManagedCronNotFound, got %v", err)
	}
}

func TestRenderManagedCronFileEndsWithNewline(t *testing.T) {
	job, err := NewManagedCronJob("backup", "0 2 * * *", "/opt/bin/backup.sh", true, false)
	if err != nil {
		t.Fatalf("build job: %v", err)
	}
	job.EntryID = "cron_alpha"
	rendered := RenderManagedCronFile(job)
	if !strings.HasSuffix(rendered, "\n") {
		t.Fatalf("expected trailing newline, got %q", rendered)
	}
	if !strings.Contains(rendered, "0 2 * * * root /opt/bin/backup.sh") {
		t.Fatalf("expected /etc/cron.d format with user column, got %q", rendered)
	}
}

func TestRenderManagedCronFileWrapsSingleRunOnlyCommand(t *testing.T) {
	job, err := NewManagedCronJob("backup", "0 2 * * *", "/opt/bin/backup.sh", true, true)
	if err != nil {
		t.Fatalf("build job: %v", err)
	}
	job.EntryID = "cron_alpha"
	rendered := RenderManagedCronFile(job)
	if !strings.Contains(rendered, "rm -f /etc/cron.d/appos-managed-cron-cron_alpha") {
		t.Fatalf("expected single-run cleanup in cron command, got %q", rendered)
	}
}
