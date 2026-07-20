package runtimepaths_test

import (
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"testing"
)

var dangerousAbsoluteTestPathPatterns = []*regexp.Regexp{
	regexp.MustCompile(`filepath\.(Join|Clean)\(\s*"/appos`),
	regexp.MustCompile(`os\.(MkdirAll|WriteFile|ReadFile|RemoveAll|Stat)\(\s*"/appos`),
}

func TestNoDangerousHardcodedAppOSPathsInTests(t *testing.T) {
	_, currentFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("resolve current file")
	}
	backendRoot := filepath.Clean(filepath.Join(filepath.Dir(currentFile), "..", ".."))

	var violations []string
	err := filepath.WalkDir(backendRoot, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}
		if !strings.HasSuffix(path, "_test.go") || path == currentFile {
			return nil
		}

		body, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		content := string(body)
		for _, pattern := range dangerousAbsoluteTestPathPatterns {
			if pattern.MatchString(content) {
				rel, relErr := filepath.Rel(backendRoot, path)
				if relErr != nil {
					rel = path
				}
				violations = append(violations, rel+": "+pattern.String())
			}
		}
		return nil
	})
	if err != nil {
		t.Fatalf("scan test files: %v", err)
	}
	if len(violations) > 0 {
		t.Fatalf("dangerous hardcoded /appos test path usage found:\n%s", strings.Join(violations, "\n"))
	}
}
