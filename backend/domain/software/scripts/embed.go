package scripts

import (
	"embed"
	"fmt"
	"path"
	"strings"
)

//go:embed *.sh
var embeddedScripts embed.FS

func ReadEmbeddedScript(scriptPath string) (string, error) {
	trimmed := strings.TrimSpace(scriptPath)
	if trimmed == "" {
		return "", fmt.Errorf("script path is empty")
	}

	data, err := embeddedScripts.ReadFile(path.Base(trimmed))
	if err != nil {
		return "", fmt.Errorf("read embedded script %q: %w", trimmed, err)
	}

	return string(data), nil
}
