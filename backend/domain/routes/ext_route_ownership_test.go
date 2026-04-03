package routes

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strings"
	"testing"
)

var (
	reOwnedRouterGroup = regexp.MustCompile(`\.Router\.Group\("(/api/ext[^"]*)"\)`)
	reOwnedGroup       = regexp.MustCompile(`\.Group\("(/api/ext[^"]*)"\)`)
	reOwnedRouteMethod = regexp.MustCompile(`\.(GET|POST|PUT|DELETE|PATCH|HEAD)\("(/api/ext[^"]*)"`)
)

// TestExtRoutesOwnedByRoutesPackage enforces the architecture rule that all
// custom /api/ext/* route registrations must live under backend/domain/routes.
func TestExtRoutesOwnedByRoutesPackage(t *testing.T) {
	_, thisFile, _, _ := runtime.Caller(0)
	routesDir := filepath.Dir(thisFile)
	backendDir := filepath.Clean(filepath.Join(routesDir, "../.."))

	var violations []string

	err := filepath.WalkDir(backendDir, func(path string, d os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if d.IsDir() {
			name := d.Name()
			if name == ".git" || name == "node_modules" || name == "vendor" {
				return filepath.SkipDir
			}
			return nil
		}

		if filepath.Ext(path) != ".go" || strings.HasSuffix(path, "_test.go") {
			return nil
		}

		rel, err := filepath.Rel(backendDir, path)
		if err != nil {
			return err
		}
		rel = filepath.ToSlash(rel)

		if strings.HasPrefix(rel, "internal/routes/") {
			return nil
		}
		if strings.HasPrefix(rel, "domain/routes/") {
			return nil
		}

		file, err := os.Open(path)
		if err != nil {
			return err
		}
		defer file.Close()

		scanner := bufio.NewScanner(file)
		lineNo := 0
		inBlockComment := false

		for scanner.Scan() {
			lineNo++
			line := scanner.Text()
			trimmed := strings.TrimSpace(line)

			if inBlockComment {
				if strings.Contains(trimmed, "*/") {
					inBlockComment = false
				}
				continue
			}

			if strings.HasPrefix(trimmed, "/*") {
				if !strings.Contains(trimmed, "*/") {
					inBlockComment = true
				}
				continue
			}

			if strings.HasPrefix(trimmed, "//") {
				continue
			}

			if matchesOwnedExtRouteRegistration(line) {
				violations = append(violations, fmt.Sprintf("%s:%d  %s", rel, lineNo, strings.TrimSpace(line)))
			}
		}

		if err := scanner.Err(); err != nil {
			return err
		}

		return nil
	})

	if err != nil {
		t.Fatalf("failed to scan backend source tree: %v", err)
	}

	if len(violations) > 0 {
		sort.Strings(violations)
		t.Fatalf(
			"/api/ext route ownership violation: registrations must be defined in backend/domain/routes only.\n\n%s",
			strings.Join(violations, "\n"),
		)
	}
}

func matchesOwnedExtRouteRegistration(line string) bool {
	if reOwnedRouterGroup.MatchString(line) {
		return true
	}
	if reOwnedGroup.MatchString(line) {
		return true
	}
	return reOwnedRouteMethod.MatchString(line)
}
