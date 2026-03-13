package certs

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

//go:embed templates.json
var embeddedTemplatesJSON []byte

type TemplateField struct {
	Key      string `json:"key"`
	Label    string `json:"label"`
	Type     string `json:"type"`
	Required bool   `json:"required,omitempty"`
	Upload   bool   `json:"upload,omitempty"`
}

type Template struct {
	ID          string          `json:"id"`
	Label       string          `json:"label"`
	Kind        string          `json:"kind"`
	Description string          `json:"description,omitempty"`
	Fields      []TemplateField `json:"fields"`
}

var (
	templatesMu sync.RWMutex
	templates   []Template
)

func LoadTemplatesFromDefaultPath() error {
	if p := os.Getenv("APPOS_CERT_TEMPLATES_PATH"); p != "" {
		return LoadTemplatesFromFile(p)
	}
	if len(embeddedTemplatesJSON) > 0 {
		return loadTemplatesFromBytes(embeddedTemplatesJSON)
	}
	return fmt.Errorf("certs/templates.json not found: embedded resource is empty")
}

func LoadTemplatesFromFile(path string) error {
	content, err := os.ReadFile(filepath.Clean(path))
	if err != nil {
		return err
	}
	return loadTemplatesFromBytes(content)
}

func loadTemplatesFromBytes(content []byte) error {
	var list []Template
	if err := json.Unmarshal(content, &list); err != nil {
		return fmt.Errorf("parse certs/templates.json: %w", err)
	}
	if len(list) == 0 {
		return fmt.Errorf("certificate templates list is empty")
	}
	seen := map[string]bool{}
	for _, tpl := range list {
		if strings.TrimSpace(tpl.ID) == "" {
			return fmt.Errorf("certificate template id is required")
		}
		if seen[tpl.ID] {
			return fmt.Errorf("duplicate certificate template id: %s", tpl.ID)
		}
		seen[tpl.ID] = true
	}

	templatesMu.Lock()
	defer templatesMu.Unlock()
	templates = list
	return nil
}

func Templates() []Template {
	templatesMu.RLock()
	defer templatesMu.RUnlock()
	out := make([]Template, len(templates))
	copy(out, templates)
	return out
}

func FindTemplate(id string) (Template, bool) {
	templatesMu.RLock()
	defer templatesMu.RUnlock()
	for _, tpl := range templates {
		if tpl.ID == id {
			return tpl, true
		}
	}
	return Template{}, false
}
