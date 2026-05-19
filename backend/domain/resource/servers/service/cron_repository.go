package service

import (
	"context"
	"encoding/base64"
	"fmt"
	"strings"
	"time"

	"github.com/websoft9/appos/backend/domain/terminal"
)

const (
	managedCronRegistryOutputPrefix = "__APPOS_REGISTRY__"
	managedCronFilesOutputPrefix    = "__APPOS_FILES__\n"
	managedCronFilesOutputMarker    = "__APPOS_FILES__"
)

type CronCommandExecutor func(ctx context.Context, cfg terminal.ConnectorConfig, command string, timeout time.Duration) (string, error)

type ManagedCronRepository interface {
	Load(ctx context.Context) (ManagedCronRegistryDocument, error)
	Write(ctx context.Context, doc ManagedCronRegistryDocument) (string, error)
}

type RemoteManagedCronRepository struct {
	Config         terminal.ConnectorConfig
	ExecuteCommand CronCommandExecutor
}

func (r RemoteManagedCronRepository) Load(ctx context.Context) (ManagedCronRegistryDocument, error) {
	raw, err := r.execute(ctx, loadManagedCrontabCommand(), 20*time.Second)
	if err != nil {
		return ManagedCronRegistryDocument{}, err
	}
	registryRaw, activeFiles, err := parseManagedCronLoadOutput(raw)
	if err != nil {
		return ManagedCronRegistryDocument{}, err
	}
	doc, err := ParseManagedCronRegistry(registryRaw)
	if err != nil {
		return ManagedCronRegistryDocument{}, err
	}
	for index := range doc.Jobs {
		doc.Jobs[index].Enabled = activeFiles[ManagedCronFileName(doc.Jobs[index].EntryID)]
	}
	return doc, nil
}

func (r RemoteManagedCronRepository) Write(ctx context.Context, doc ManagedCronRegistryDocument) (string, error) {
	script, err := buildManagedCronWriteScript(doc)
	if err != nil {
		return "", err
	}
	return r.execute(ctx, encodeShellScript(script), 25*time.Second)
}

func loadManagedCrontabCommand() string {
	script := strings.Join([]string{
		"set -eu",
		fmt.Sprintf("registry_path=%s", shellQuote(ManagedCronRegistryPath)),
		fmt.Sprintf("runtime_dir=%s", shellQuote(ManagedCronRuntimeDir)),
		fmt.Sprintf("file_prefix=%s", shellQuote(ManagedCronFilePrefix)),
		"registry_b64=''",
		"if [ -f \"$registry_path\" ]; then registry_b64=$(base64 < \"$registry_path\" | tr -d '\\n'); fi",
		fmt.Sprintf("printf %s \"$registry_b64\"", shellQuote(managedCronRegistryOutputPrefix+"%s\\n"+managedCronFilesOutputPrefix)),
		"find \"$runtime_dir\" -maxdepth 1 -type f -name \"${file_prefix}*\" -printf '%f\\n' 2>/dev/null | LC_ALL=C sort || true",
	}, "\n")
	return encodeShellScript(script)
}

func buildManagedCronWriteScript(doc ManagedCronRegistryDocument) (string, error) {
	registryEncoded := base64.StdEncoding.EncodeToString([]byte(doc.Render()))
	lines := []string{
		"set -eu",
		"tmp_dir=$(mktemp -d)",
		"cleanup() { rm -rf \"$tmp_dir\"; }",
		"trap cleanup EXIT",
		fmt.Sprintf("registry_path=%s", shellQuote(ManagedCronRegistryPath)),
		fmt.Sprintf("runtime_dir=%s", shellQuote(ManagedCronRuntimeDir)),
		fmt.Sprintf("file_prefix=%s", shellQuote(ManagedCronFilePrefix)),
		"registry_dir=$(dirname \"$registry_path\")",
		fmt.Sprintf("printf '%%s' %s | base64 -d > \"$tmp_dir/registry.json\"", shellQuote(registryEncoded)),
		"if sudo -n true >/dev/null 2>&1; then",
		"  sudo -n mkdir -p \"$registry_dir\"",
		"  sudo -n install -m 0644 \"$tmp_dir/registry.json\" \"$registry_path\"",
		"  sudo -n find \"$runtime_dir\" -maxdepth 1 -type f -name \"${file_prefix}*\" -delete 2>/dev/null || true",
		"else",
		"  mkdir -p \"$registry_dir\"",
		"  install -m 0644 \"$tmp_dir/registry.json\" \"$registry_path\"",
		"  find \"$runtime_dir\" -maxdepth 1 -type f -name \"${file_prefix}*\" -delete 2>/dev/null || true",
		"fi",
	}
	for _, job := range doc.Jobs {
		if !job.Enabled {
			continue
		}
		fileName := ManagedCronFileName(job.EntryID)
		fileEncoded := base64.StdEncoding.EncodeToString([]byte(RenderManagedCronFile(job)))
		lines = append(lines,
			fmt.Sprintf("printf '%%s' %s | base64 -d > \"$tmp_dir/%s\"", shellQuote(fileEncoded), fileName),
			"if sudo -n true >/dev/null 2>&1; then",
			fmt.Sprintf("  sudo -n install -m 0644 \"$tmp_dir/%s\" %s", fileName, shellQuote(ManagedCronFilePath(job.EntryID))),
			"else",
			fmt.Sprintf("  install -m 0644 \"$tmp_dir/%s\" %s", fileName, shellQuote(ManagedCronFilePath(job.EntryID))),
			"fi",
		)
	}
	lines = append(lines, fmt.Sprintf("printf %s", shellQuote("managed cron registry updated\\n")))
	return strings.Join(lines, "\n"), nil
}

func parseManagedCronLoadOutput(raw string) (string, map[string]bool, error) {
	normalized := strings.ReplaceAll(raw, "\r\n", "\n")
	start := strings.Index(normalized, managedCronRegistryOutputPrefix)
	if start < 0 {
		return "", nil, fmt.Errorf("invalid managed cron load output")
	}
	remainder := normalized[start+len(managedCronRegistryOutputPrefix):]
	registryLineEnd := strings.Index(remainder, "\n")
	if registryLineEnd < 0 {
		return "", nil, fmt.Errorf("invalid managed cron load output")
	}
	registryEncoded := strings.TrimSpace(remainder[:registryLineEnd])
	filesStart := strings.Index(remainder[registryLineEnd+1:], managedCronFilesOutputMarker)
	if filesStart < 0 {
		return "", nil, fmt.Errorf("invalid managed cron load output")
	}
	filesSection := remainder[registryLineEnd+1+filesStart+len(managedCronFilesOutputMarker):]
	filesSection = strings.TrimPrefix(filesSection, "\n")
	filesSection = strings.TrimPrefix(filesSection, "\r")
	registryRaw := ""
	if registryEncoded != "" {
		decoded, err := base64.StdEncoding.DecodeString(registryEncoded)
		if err != nil {
			return "", nil, fmt.Errorf("invalid managed cron registry encoding: %w", err)
		}
		registryRaw = string(decoded)
	}
	activeFiles := map[string]bool{}
	filesSection = strings.TrimSpace(filesSection)
	if filesSection == "" {
		return registryRaw, activeFiles, nil
	}
	for _, line := range strings.Split(filesSection, "\n") {
		name := strings.TrimSpace(line)
		if name == "" || !strings.HasPrefix(name, ManagedCronFilePrefix) {
			continue
		}
		activeFiles[name] = true
	}
	return registryRaw, activeFiles, nil
}

func encodeShellScript(script string) string {
	encoded := base64.StdEncoding.EncodeToString([]byte(script))
	return fmt.Sprintf("printf '%%s' %s | base64 -d | sh", shellQuote(encoded))
}

func (r RemoteManagedCronRepository) execute(ctx context.Context, command string, timeout time.Duration) (string, error) {
	if r.ExecuteCommand == nil {
		return "", fmt.Errorf("cron command executor is required")
	}
	return r.ExecuteCommand(ctx, r.Config, command, timeout)
}