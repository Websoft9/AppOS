package apptemplates

import (
	"os"
	"path/filepath"
	"testing"
)

func TestDescribeFindsRuntimeTemplateUnderApposDataTemplatesApps(t *testing.T) {
	const key = "runtime-template-test"
	templateDir := filepath.Join("/appos/data/templates/apps", key)
	composeDir := filepath.Join(templateDir, "compose")

	if err := os.MkdirAll(composeDir, 0o755); err != nil {
		t.Fatalf("mkdir template dir: %v", err)
	}
	write := func(path, content string) {
		t.Helper()
		if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
			t.Fatalf("write %s: %v", path, err)
		}
	}
	write(filepath.Join(templateDir, "manifest.json"), `{"key":"runtime-template-test","name":"Runtime Template Test","trademark":"Runtime Template Test","category":"Test","requirements":{},"serviceRoles":{}}`)
	write(filepath.Join(templateDir, "inputs.schema.json"), `{"fields":[{"key":"admin_email","type":"string","label":"Admin Email","required":true,"default":"admin@example.com","visibility":"basic","storage_mode":"plain"}]}`)
	write(filepath.Join(templateDir, "render.json"), `{"env":{"ADMIN_EMAIL":"${admin_email}"},"compose_values":{},"exposure":{},"files":[]}`)
	write(filepath.Join(templateDir, "source.json"), `{"template_revision":"test","origin_kind":"runtime","origin_ref":"unit-test"}`)
	write(filepath.Join(composeDir, "base.yml"), "services:\n  app:\n    image: nginx:alpine\n")
	t.Cleanup(func() {
		_ = os.RemoveAll(templateDir)
	})

	response, err := NewService().Describe(key)
	if err != nil {
		t.Fatalf("describe runtime template: %v", err)
	}
	if response.TemplateKey != key {
		t.Fatalf("expected template key %q, got %q", key, response.TemplateKey)
	}
	if response.Manifest.Trademark != "Runtime Template Test" {
		t.Fatalf("expected trademark Runtime Template Test, got %q", response.Manifest.Trademark)
	}
}