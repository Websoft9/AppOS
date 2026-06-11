package runtimecfg

import (
	"os"
	"path/filepath"
	"testing"
)

func TestResolveArgsDefaults(t *testing.T) {
	cfg, updatedArgs, err := ResolveArgs([]string{"appos", "serve"})
	if err != nil {
		t.Fatal(err)
	}
	if cfg.RedisURL != DefaultRedisURL {
		t.Fatalf("expected default redis url %q, got %q", DefaultRedisURL, cfg.RedisURL)
	}
	if cfg.TSDBURL != DefaultTSDBURL {
		t.Fatalf("expected default tsdb url %q, got %q", DefaultTSDBURL, cfg.TSDBURL)
	}
	if cfg.TunnelSSHPort != DefaultTunnelSSHPort {
		t.Fatalf("expected default tunnel port %q, got %q", DefaultTunnelSSHPort, cfg.TunnelSSHPort)
	}
	if len(updatedArgs) != 2 || updatedArgs[1] != "serve" {
		t.Fatalf("expected unchanged args, got %#v", updatedArgs)
	}
}

func TestResolveArgsDataDirInjectsPocketBaseDir(t *testing.T) {
	cfg, updatedArgs, err := ResolveArgs([]string{"appos", "serve", "--data-dir", "/srv/appos"})
	if err != nil {
		t.Fatal(err)
	}
	if cfg.DataDir != "/srv/appos" {
		t.Fatalf("expected data dir override, got %q", cfg.DataDir)
	}
	if !hasArgPair(updatedArgs, "--dir", "/srv/appos/pb/pb_data") {
		t.Fatalf("expected derived PocketBase dir in args, got %#v", updatedArgs)
	}
}

func TestResolveArgsConfigAndFlagOverride(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "appos.yaml")
	if err := os.WriteFile(configPath, []byte("data_dir: /srv/appos\nhttp: 0.0.0.0:9090\nredis_url: redis://config:6379/1\ntsdb_url: https://metrics.internal\ntunnel_ssh_port: '2200'\ninit_mode: setup\nsuperuser_email: admin@example.com\nsuperuser_password: config-secret\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	cfg, updatedArgs, err := ResolveArgs([]string{"appos", "serve", "--config", configPath, "--redis-url", "rediss://flag:6379", "--superuser-password=flag-secret"})
	if err != nil {
		t.Fatal(err)
	}
	if cfg.HTTP != "0.0.0.0:9090" {
		t.Fatalf("expected config http, got %q", cfg.HTTP)
	}
	if cfg.DataDir != "/srv/appos" {
		t.Fatalf("expected config data dir, got %q", cfg.DataDir)
	}
	if cfg.RedisURL != "rediss://flag:6379" {
		t.Fatalf("expected flag override redis url, got %q", cfg.RedisURL)
	}
	if cfg.TSDBURL != "https://metrics.internal" {
		t.Fatalf("expected config tsdb url, got %q", cfg.TSDBURL)
	}
	if cfg.InitMode != "setup" {
		t.Fatalf("expected config init mode, got %q", cfg.InitMode)
	}
	if cfg.SuperuserPassword != "flag-secret" {
		t.Fatalf("expected flag override password, got %q", cfg.SuperuserPassword)
	}
	if !hasArgPair(updatedArgs, "--http", "0.0.0.0:9090") {
		t.Fatalf("expected http flag injected into args, got %#v", updatedArgs)
	}
	if !hasArgPair(updatedArgs, "--dir", "/srv/appos/pb/pb_data") {
		t.Fatalf("expected dir flag injected into args, got %#v", updatedArgs)
	}
}

func TestIsServeCommand(t *testing.T) {
	if !IsServeCommand([]string{"serve", "--config", "cfg.yaml"}) {
		t.Fatal("expected explicit serve command to return true")
	}
	if !IsServeCommand([]string{"--config", "cfg.yaml"}) {
		t.Fatal("expected empty subcommand to default to serve")
	}
	if IsServeCommand([]string{"superuser", "upsert", "admin@example.com", "secret"}) {
		t.Fatal("expected non-serve command to return false")
	}
}

func hasArgPair(args []string, name string, value string) bool {
	for index := 0; index < len(args)-1; index++ {
		if args[index] == name && args[index+1] == value {
			return true
		}
	}
	return false
}
