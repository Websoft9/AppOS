package migrations

import (
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
)

func TestOnlyBaselineCreationMigrationsImportBaselineSchema(t *testing.T) {
	files, err := filepath.Glob("*.go")
	if err != nil {
		t.Fatalf("glob migration files: %v", err)
	}

	for _, file := range files {
		if strings.HasSuffix(file, "_test.go") || file == "migrations.go" {
			continue
		}
		content, readErr := os.ReadFile(file)
		if readErr != nil {
			t.Fatalf("read %s: %v", file, readErr)
		}
		body := string(content)
		if strings.Contains(body, `github.com/websoft9/appos/backend/infra/schema/baseline/`) {
			t.Fatalf("%s must not import deprecated baseline schema packages", file)
		}
		importsSchema := strings.Contains(body, `github.com/websoft9/appos/backend/infra/schema`)
		if importsSchema && file != "v03.06.00_initial.go" {
			t.Fatalf("%s must not import infra/schema directly; only the initial bootstrap migration may do that", file)
		}
	}
}

func TestAtMostOneVersionedMigrationPerReleaseVersion(t *testing.T) {
	files, err := filepath.Glob("*.go")
	if err != nil {
		t.Fatalf("glob migration files: %v", err)
	}

	allowed := map[string]bool{
		"v03.06.00_initial.go": true,
		"migrations.go":        true,
		"governance_test.go":   true,
		"migrations_test.go":   true,
		"test_fixture_test.go": true,
		".gitkeep":             true,
	}

	var unexpected []string
	for _, file := range files {
		if !allowed[file] {
			unexpected = append(unexpected, file)
		}
	}

	if len(unexpected) > 0 {
		sort.Strings(unexpected)
		t.Fatalf("unexpected files in MVP migration set: %s", strings.Join(unexpected, ", "))
	}
}
