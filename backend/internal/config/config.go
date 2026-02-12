package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"

	"github.com/joho/godotenv"
)

type Config struct {
	// Server
	Port      int
	Env       string
	Version   string
	LogLevel  string
	LogFormat string

	// Redis
	RedisURL  string
	RedisAddr string // host:port format for Asynq

	// Convex
	ConvexURL       string
	ConvexDeployKey string

	// CORS
	CORSAllowedOrigins []string

	// Docker
	DockerHost string
}

func Load() (*Config, error) {
	// Load .env file if exists
	_ = godotenv.Load()

	cfg := &Config{
		Port:               getEnvAsInt("PORT", 8080),
		Env:                getEnv("ENV", "development"),
		Version:            getEnv("VERSION", "0.1.0"),
		LogLevel:           getEnv("LOG_LEVEL", "info"),
		LogFormat:          getEnv("LOG_FORMAT", "json"),
		RedisURL:           getEnv("REDIS_URL", "redis://localhost:6379"),
		ConvexURL:          getEnv("CONVEX_URL", ""),
		ConvexDeployKey:    getEnv("CONVEX_DEPLOY_KEY", ""),
		CORSAllowedOrigins: getEnvAsSlice("CORS_ALLOWED_ORIGINS", []string{"http://localhost:5173"}),
		DockerHost:         getEnv("DOCKER_HOST", "unix:///var/run/docker.sock"),
	}

	// Parse Redis URL to get host:port
	cfg.RedisAddr = parseRedisAddr(cfg.RedisURL)

	// Validate required fields
	if cfg.ConvexURL == "" {
		return nil, fmt.Errorf("CONVEX_URL is required")
	}

	return cfg, nil
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

func getEnvAsInt(key string, defaultValue int) int {
	valueStr := getEnv(key, "")
	if value, err := strconv.Atoi(valueStr); err == nil {
		return value
	}
	return defaultValue
}

func getEnvAsSlice(key string, defaultValue []string) []string {
	valueStr := getEnv(key, "")
	if valueStr == "" {
		return defaultValue
	}
	
	// Simple CSV split (for more complex parsing, use a proper CSV library)
	var result []string
	current := ""
	for _, char := range valueStr {
		if char == ',' {
			if current != "" {
				result = append(result, current)
				current = ""
			}
		} else {
			current += string(char)
		}
	}
	if current != "" {
		result = append(result, current)
	}
	
	return result
}

// parseRedisAddr extracts host:port from Redis URL
// Supports: redis://host:port, host:port, host
func parseRedisAddr(redisURL string) string {
	// Remove redis:// prefix if present
	addr := strings.TrimPrefix(redisURL, "redis://")
	addr = strings.TrimPrefix(addr, "rediss://")
	
	// Remove trailing slash if present
	addr = strings.TrimSuffix(addr, "/")
	
	// If no port specified, add default Redis port
	if !strings.Contains(addr, ":") {
		addr = addr + ":6379"
	}
	
	return addr
}
