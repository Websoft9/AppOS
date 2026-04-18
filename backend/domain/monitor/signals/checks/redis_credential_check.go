package checks

import (
	"context"
	"strings"
	"time"

	"github.com/websoft9/appos/backend/domain/monitor"
	"github.com/websoft9/appos/backend/domain/secrets"
)

func checkRedisInstanceCredential(target monitor.ResolvedInstanceTarget, resolved *secrets.ResolveResult) CredentialCheckResult {
	item := target.Item
	host, port, err := InstanceProbeTarget(item.Endpoint(), item.Kind())
	if err != nil {
		return CredentialCheckResult{
			Status:             target.CredentialStatusFor("unknown"),
			Reason:             target.CredentialReasonFor("unknown", err.Error()),
			Action:             "redis_ping",
			CredentialTemplate: strings.TrimSpace(resolved.TemplateID),
		}
	}

	password, passwordKey := firstCredentialString(resolved.Payload, "password", "value", "token", "api_key")
	if password == "" {
		return CredentialCheckResult{
			Status:             target.CredentialStatusFor("auth_failed"),
			Reason:             target.CredentialReasonFor("auth_failed", "credential payload does not contain a usable password"),
			Action:             "redis_ping",
			CredentialTemplate: strings.TrimSpace(resolved.TemplateID),
		}
	}

	config := item.Config()
	err = ProbeRedisCredential(context.Background(), RedisCredentialProbeInput{
		Host:     host,
		Port:     port,
		Username: stringConfigValue(config, "username", "user"),
		Password: password,
		DB:       intConfigValue(config, 0, "database", "database_index", "db"),
		Timeout:  3 * time.Second,
	})
	if err == nil {
		return CredentialCheckResult{
			Status:             target.CredentialStatusFor("success"),
			Action:             "redis_ping",
			CredentialTemplate: strings.TrimSpace(resolved.TemplateID),
			ObservedValueKey:   passwordKey,
		}
	}
	if isCredentialAuthError(err) {
		return CredentialCheckResult{
			Status:             target.CredentialStatusFor("auth_failed"),
			Reason:             target.CredentialReasonFor("auth_failed", err.Error()),
			Action:             "redis_ping",
			CredentialTemplate: strings.TrimSpace(resolved.TemplateID),
			ObservedValueKey:   passwordKey,
		}
	}
	if IsConnectivityError(err) {
		return CredentialCheckResult{
			Status:             target.CredentialStatusFor("unreachable"),
			Reason:             target.CredentialReasonFor("unreachable", err.Error()),
			Action:             "redis_ping",
			CredentialTemplate: strings.TrimSpace(resolved.TemplateID),
			ObservedValueKey:   passwordKey,
		}
	}
	return CredentialCheckResult{
		Status:             target.CredentialStatusFor("unknown"),
		Reason:             target.CredentialReasonFor("unknown", err.Error()),
		Action:             "redis_ping",
		CredentialTemplate: strings.TrimSpace(resolved.TemplateID),
		ObservedValueKey:   passwordKey,
	}
}
