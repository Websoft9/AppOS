package apptemplates

import (
	"os"
	"path/filepath"
	"testing"
)

func TestDescribeFindsRuntimeTemplateUnderApposDataTemplatesApps(t *testing.T) {
	const key = "runtime-template-test"
	root := t.TempDir()
	templateDir := filepath.Join(root, key)
	composeDir := filepath.Join(templateDir, "compose")

	if err := os.MkdirAll(composeDir, 0o755); err != nil {
		t.Fatalf("mkdir template dir: %v", err)
	}
	write := func(path, content string) {
		t.Helper()
		if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
			t.Fatalf("write %s: %v", path, err)
		}
	}
	write(filepath.Join(templateDir, "manifest.json"), `{"key":"runtime-template-test","name":"Runtime Template Test","trademark":"Runtime Template Test","category":"Test","requirements":{},"serviceRoles":{}}`)
	write(filepath.Join(templateDir, "inputs.schema.json"), `{"fields":[{"key":"admin_email","type":"string","label":"Admin Email","required":true,"default":"admin@example.com","visibility":"basic","storage_mode":"plain"}]}`)
	write(filepath.Join(templateDir, "render.json"), `{"env":{"ADMIN_EMAIL":"${admin_email}"},"compose_values":{},"exposures":[{"label":"Web","service":"app","port":80,"protocol":"http","default":true}],"files":[]}`)
	write(filepath.Join(templateDir, "source.json"), `{"template_revision":"test","origin_kind":"runtime","origin_ref":"unit-test"}`)
	write(filepath.Join(composeDir, "base.yml"), "services:\n  app:\n    image: nginx:alpine\n")

	response, err := NewServiceWithRoots(root).Describe(key)
	if err != nil {
		t.Fatalf("describe runtime template: %v", err)
	}
	if response.TemplateKey != key {
		t.Fatalf("expected template key %q, got %q", key, response.TemplateKey)
	}
	if response.Manifest.Trademark != "Runtime Template Test" {
		t.Fatalf("expected trademark Runtime Template Test, got %q", response.Manifest.Trademark)
	}
	if len(response.Exposures) != 1 || response.Exposures[0].Service != "app" || response.Exposures[0].Port != 80 {
		t.Fatalf("expected compact exposures in describe response, got %+v", response.Exposures)
	}
}
