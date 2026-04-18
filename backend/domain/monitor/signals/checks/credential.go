package checks

import (
	"context"
	"errors"
	"net"
	"strconv"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
)

type RedisCredentialProbeInput struct {
	Host     string
	Port     int
	Username string
	Password string
	DB       int
	Timeout  time.Duration
}

func ProbeRedisCredential(ctx context.Context, input RedisCredentialProbeInput) error {
	client := redis.NewClient(&redis.Options{
		Addr:         net.JoinHostPort(input.Host, strconv.Itoa(input.Port)),
		Username:     input.Username,
		Password:     input.Password,
		DB:           input.DB,
		DialTimeout:  input.Timeout,
		ReadTimeout:  input.Timeout,
		WriteTimeout: input.Timeout,
	})
	defer client.Close()
	ctx, cancel := context.WithTimeout(ctx, input.Timeout)
	defer cancel()
	return client.Ping(ctx).Err()
}

func IsConnectivityError(err error) bool {
	if err == nil {
		return false
	}
	var netErr net.Error
	if errors.As(err, &netErr) {
		return true
	}
	message := strings.ToLower(strings.TrimSpace(err.Error()))
	return strings.Contains(message, "dial tcp") ||
		strings.Contains(message, "connection refused") ||
		strings.Contains(message, "i/o timeout") ||
		strings.Contains(message, "network is unreachable")
}
