package runtimecfg

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"gopkg.in/yaml.v3"
)

const (
	DefaultRedisURL      = "redis://127.0.0.1:6379"
	DefaultTSDBURL       = "http://127.0.0.1:8428"
	DefaultTunnelSSHPort = "2222"
	DefaultInitMode      = "auto"
	DefaultPBSubdir      = "pb/pb_data"
)

type Config struct {
	ConfigPath        string `yaml:"-"`
	DataDir           string `yaml:"data_dir"`
	HTTP              string `yaml:"http"`
	Dir               string `yaml:"dir"`
	RedisURL          string `yaml:"redis_url"`
	TSDBURL           string `yaml:"tsdb_url"`
	TunnelSSHPort     string `yaml:"tunnel_ssh_port"`
	InitMode          string `yaml:"init_mode"`
	SuperuserEmail    string `yaml:"superuser_email"`
	SuperuserPassword string `yaml:"superuser_password"`
}

var (
	mu      sync.RWMutex
	current = Defaults()
)

func Defaults() Config {
	return Config{
		RedisURL:      DefaultRedisURL,
		TSDBURL:       DefaultTSDBURL,
		TunnelSSHPort: DefaultTunnelSSHPort,
		InitMode:      DefaultInitMode,
	}
}

func Set(cfg Config) {
	mu.Lock()
	current = cfg
	mu.Unlock()
}

func Get() Config {
	mu.RLock()
	defer mu.RUnlock()
	return current
}

func DataDir() string {
	return strings.TrimSpace(Get().DataDir)
}

func RedisURL() string {
	return Get().RedisURL
}

func TSDBURL() string {
	return Get().TSDBURL
}

func TunnelPort() string {
	port := strings.TrimSpace(Get().TunnelSSHPort)
	if port == "" {
		return DefaultTunnelSSHPort
	}
	return port
}

func InitMode() string {
	mode := strings.TrimSpace(Get().InitMode)
	if mode == "" {
		return DefaultInitMode
	}
	return mode
}

func ResolveArgs(args []string) (Config, []string, error) {
	cfg := Defaults()
	configPath, _ := parseFlagValue(args[1:], "config")
	if configPath != "" {
		resolved, err := filepath.Abs(configPath)
		if err != nil {
			return Config{}, nil, fmt.Errorf("resolve config path: %w", err)
		}
		cfg.ConfigPath = resolved
		if err := loadYAML(resolved, &cfg); err != nil {
			return Config{}, nil, err
		}
	}

	applyFlagOverride(args[1:], "redis-url", &cfg.RedisURL)
	applyFlagOverride(args[1:], "tsdb-url", &cfg.TSDBURL)
	applyFlagOverride(args[1:], "tunnel-ssh-port", &cfg.TunnelSSHPort)
	applyFlagOverride(args[1:], "data-dir", &cfg.DataDir)
	applyFlagOverride(args[1:], "init-mode", &cfg.InitMode)
	applyFlagOverride(args[1:], "superuser-email", &cfg.SuperuserEmail)
	applyFlagOverride(args[1:], "superuser-password", &cfg.SuperuserPassword)

	updatedArgs := append([]string(nil), args...)
	if cfg.HTTP != "" && !hasFlag(args[1:], "http") {
		updatedArgs = append(updatedArgs, "--http", cfg.HTTP)
	}
	pocketBaseDir := strings.TrimSpace(cfg.Dir)
	if pocketBaseDir == "" && strings.TrimSpace(cfg.DataDir) != "" {
		pocketBaseDir = filepath.Join(strings.TrimSpace(cfg.DataDir), DefaultPBSubdir)
	}
	if pocketBaseDir != "" && !hasFlag(args[1:], "dir") {
		updatedArgs = append(updatedArgs, "--dir", pocketBaseDir)
	}

	return cfg, updatedArgs, nil
}

func IsServeCommand(args []string) bool {
	for index := 0; index < len(args); index++ {
		arg := args[index]
		if arg == "--" {
			break
		}
		if !strings.HasPrefix(arg, "-") {
			return arg == "serve"
		}
		if consumesNextValue(arg) && !strings.Contains(arg, "=") {
			index++
		}
	}
	return true
}

func RegisterFlags(register func(name string, value string, usage string)) {
	defaults := Defaults()
	register("config", "", "Path to the AppOS YAML runtime config file")
	register("data-dir", "", "AppOS data root directory; PocketBase data will live under <data-dir>/pb/pb_data")
	register("redis-url", defaults.RedisURL, "Redis connection URL used by AppOS background workers")
	register("tsdb-url", defaults.TSDBURL, "VictoriaMetrics base URL used by AppOS metrics reads and writes")
	register("tunnel-ssh-port", defaults.TunnelSSHPort, "Public SSH port exposed by the AppOS tunnel service")
	register("init-mode", defaults.InitMode, "Initial setup mode: auto or setup")
	register("superuser-email", "", "Bootstrap superuser email when init-mode=auto")
	register("superuser-password", "", "Bootstrap superuser password when init-mode=auto")
}

func loadYAML(path string, cfg *Config) error {
	data, err := os.ReadFile(filepath.Clean(path))
	if err != nil {
		return fmt.Errorf("read appos config %s: %w", path, err)
	}
	if err := yaml.Unmarshal(data, cfg); err != nil {
		return fmt.Errorf("parse appos config %s: %w", path, err)
	}
	return nil
}

func hasFlag(args []string, name string) bool {
	prefix := "--" + name
	for index := 0; index < len(args); index++ {
		arg := args[index]
		if arg == prefix || strings.HasPrefix(arg, prefix+"=") {
			return true
		}
		if consumesNextValue(arg) && !strings.Contains(arg, "=") {
			index++
		}
	}
	return false
}

func applyFlagOverride(args []string, name string, target *string) {
	if value, ok := parseFlagValue(args, name); ok {
		*target = value
	}
}

func parseFlagValue(args []string, name string) (string, bool) {
	prefix := "--" + name
	for index := 0; index < len(args); index++ {
		arg := args[index]
		if arg == prefix {
			if index+1 >= len(args) {
				return "", true
			}
			return args[index+1], true
		}
		if strings.HasPrefix(arg, prefix+"=") {
			return strings.TrimPrefix(arg, prefix+"="), true
		}
		if consumesNextValue(arg) && !strings.Contains(arg, "=") {
			index++
		}
	}
	return "", false
}

func consumesNextValue(arg string) bool {
	if !strings.HasPrefix(arg, "-") || strings.Contains(arg, "=") {
		return false
	}
	name := strings.TrimLeft(arg, "-")
	switch name {
	case "config", "data-dir", "redis-url", "tsdb-url", "tunnel-ssh-port", "init-mode", "superuser-email", "superuser-password", "http", "dir":
		return true
	default:
		return false
	}
}
