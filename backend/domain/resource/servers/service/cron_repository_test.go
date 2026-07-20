package service

import (
	"encoding/base64"
	"strings"
	"testing"
)

func TestLoadManagedCrontabCommandUsesEncodedShellScript(t *testing.T) {
	command := loadManagedCrontabCommand()
	if !strings.HasPrefix(command, "printf '%s' '") || !strings.HasSuffix(command, "' | base64 -d | sh") {
		t.Fatalf("expected encoded shell command, got %q", command)
	}
}

func TestParseManagedCronLoadOutputParsesRegistryAndFiles(t *testing.T) {
	registry := ManagedCronRegistryDocument{Jobs: []ManagedCronJob{{EntryID: "cron_alpha", Name: "backup", Schedule: "0 2 * * *", Command: "/opt/bin/backup.sh"}}}.Render()
	encodedRegistry := base64.StdEncoding.EncodeToString([]byte(registry))
	raw := managedCronRegistryOutputPrefix + encodedRegistry + "\n" + managedCronFilesOutputPrefix + ManagedCronFileName("cron_alpha") + "\n"

	registryRaw, activeFiles, err := parseManagedCronLoadOutput(raw)
	if err != nil {
		t.Fatalf("expected parse success, got %v", err)
	}
	if registryRaw != registry {
		t.Fatalf("expected registry raw %q, got %q", registry, registryRaw)
	}
	if !activeFiles[ManagedCronFileName("cron_alpha")] {
		t.Fatalf("expected active file map to include cron_alpha, got %+v", activeFiles)
	}
}

func TestParseManagedCronLoadOutputIgnoresShellNoise(t *testing.T) {
	registry := ManagedCronRegistryDocument{Jobs: []ManagedCronJob{{EntryID: "cron_alpha", Name: "backup", Schedule: "0 2 * * *", Command: "/opt/bin/backup.sh"}}}.Render()
	encodedRegistry := base64.StdEncoding.EncodeToString([]byte(registry))
	raw := strings.Join([]string{
		"Pseudo-terminal will not be allocated because stdin is not a terminal.",
		managedCronRegistryOutputPrefix + encodedRegistry,
		"Last login: Tue May 19 08:00:00 2026 from 10.0.0.1",
		managedCronFilesOutputPrefix + ManagedCronFileName("cron_alpha"),
		"sudo: unable to resolve host demo-server: Name or service not known",
	}, "\n")

	registryRaw, activeFiles, err := parseManagedCronLoadOutput(raw)
	if err != nil {
		t.Fatalf("expected parse success, got %v", err)
	}
	if registryRaw != registry {
		t.Fatalf("expected registry raw %q, got %q", registry, registryRaw)
	}
	if len(activeFiles) != 1 || !activeFiles[ManagedCronFileName("cron_alpha")] {
		t.Fatalf("expected only managed cron runtime file, got %+v", activeFiles)
	}
}
