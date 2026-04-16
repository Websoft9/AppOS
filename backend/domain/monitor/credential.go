package monitor

import (
	"context"
	"errors"
	"fmt"
	"net"
	"strconv"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/redis/go-redis/v9"
	"github.com/websoft9/appos/backend/domain/resource/instances"
	"github.com/websoft9/appos/backend/domain/secrets"
	persistence "github.com/websoft9/appos/backend/infra/persistence"
)

type CredentialCheckResult struct {
	Status             string
	Reason             string
	Action             string
	CredentialTemplate string
	ObservedValueKey   string
}

type redisCredentialProbeInput struct {
	Host     string
	Port     int
	Username string
	Password string
	DB       int
	Timeout  time.Duration
}

var redisCredentialProbe = probeRedisCredential

func RunInstanceCredentialSweep(app core.App, now time.Time) error {
	items, err := instances.List(persistence.NewInstanceRepository(app), nil)
	if err != nil {
		return err
	}
	for _, item := range items {
		target, ok, err := ResolveInstanceTarget(item)
		if err != nil {
			return err
		}
		if !ok {
			continue
		}
		eligible, _ := target.EligibleForCredential()
		if !eligible {
			continue
		}
		result := CheckInstanceCredential(app, target)
		if err := projectInstanceCredential(app, target, result, now); err != nil {
			return err
		}
	}
	return nil
}

func CheckInstanceCredential(app core.App, target ResolvedInstanceTarget) CredentialCheckResult {
	item := target.Item
	if strings.TrimSpace(item.CredentialID()) == "" {
		return CredentialCheckResult{Status: target.CredentialStatusFor("auth_failed"), Reason: target.CredentialReasonFor("auth_failed", "instance credential is empty")}
	}

	resolved, err := secrets.Resolve(app, item.CredentialID(), "system")
	if err != nil {
		return CredentialCheckResult{Status: target.CredentialStatusFor("auth_failed"), Reason: target.CredentialReasonFor("auth_failed", err.Error())}
	}

	switch strings.TrimSpace(item.Kind()) {
	case instances.KindRedis:
		return checkRedisInstanceCredential(target, resolved)
	default:
		return CredentialCheckResult{Status: target.CredentialStatusFor("unknown"), Reason: target.CredentialReasonFor("unknown", "credential check is not implemented for this resource kind")}
	}
}

func checkRedisInstanceCredential(target ResolvedInstanceTarget, resolved *secrets.ResolveResult) CredentialCheckResult {
	item := target.Item
	host, port, err := instanceProbeTarget(item.Endpoint(), item.Kind())
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
	err = redisCredentialProbe(context.Background(), redisCredentialProbeInput{
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
	if isConnectivityError(err) {
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

func projectInstanceCredential(app core.App, target ResolvedInstanceTarget, result CredentialCheckResult, now time.Time) error {
	item := target.Item
	failures := previousFailureCount(app, TargetTypeResource, item.ID())
	lastSuccessAt := (*time.Time)(nil)
	lastFailureAt := (*time.Time)(nil)
	if result.Status == StatusHealthy {
		failures = 0
		lastSuccessAt = &now
	} else {
		failures++
		lastFailureAt = &now
	}

	summary := LoadExistingSummary(app, TargetTypeResource, item.ID())
	summary["check_kind"] = CheckKindCredential
	summary["registry_entry_id"] = target.Entry.ID
	summary["resource_kind"] = item.Kind()
	summary["template_id"] = item.TemplateID()
	summary["endpoint"] = item.Endpoint()
	summary["credential_id"] = item.CredentialID()
	ApplyReasonCode(summary, target.CredentialReasonCodeFor(summaryCredentialOutcome(result.Status), ""))
	if result.Action != "" {
		summary["credential_action"] = result.Action
	}
	if result.CredentialTemplate != "" {
		summary["credential_template"] = result.CredentialTemplate
	}
	if result.ObservedValueKey != "" {
		summary["credential_value_key"] = result.ObservedValueKey
	}

	_, err := UpsertLatestStatus(app, LatestStatusUpsert{
		TargetType:              TargetTypeResource,
		TargetID:                item.ID(),
		DisplayName:             firstNonEmpty(item.Name(), item.ID()),
		Status:                  result.Status,
		Reason:                  strings.TrimSpace(result.Reason),
		SignalSource:            SignalSourceAppOS,
		LastTransitionAt:        now,
		LastSuccessAt:           lastSuccessAt,
		LastFailureAt:           lastFailureAt,
		LastCheckedAt:           &now,
		ConsecutiveFailures:     &failures,
		Summary:                 summary,
		StatusPriorityMap:       target.Entry.StatusPriority,
		PreserveStrongerFailure: preserveStrongerFailureFromOtherCheck(app, TargetTypeResource, item.ID(), CheckKindCredential),
	})
	return err
}

func probeRedisCredential(ctx context.Context, input redisCredentialProbeInput) error {
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

func firstCredentialString(payload map[string]any, keys ...string) (string, string) {
	for _, key := range keys {
		value := secrets.FirstStringFromPayload(payload, key)
		if value != "" {
			return value, key
		}
	}
	return "", ""
}

func stringConfigValue(config map[string]any, keys ...string) string {
	for _, key := range keys {
		value, ok := config[key]
		if !ok {
			continue
		}
		text, ok := value.(string)
		if ok {
			text = strings.TrimSpace(text)
			if text != "" {
				return text
			}
		}
	}
	return ""
}

func intConfigValue(config map[string]any, defaultValue int, keys ...string) int {
	for _, key := range keys {
		value, ok := config[key]
		if !ok || value == nil {
			continue
		}
		switch typed := value.(type) {
		case int:
			return typed
		case int32:
			return int(typed)
		case int64:
			return int(typed)
		case float64:
			return int(typed)
		case string:
			parsed, err := strconv.Atoi(strings.TrimSpace(typed))
			if err == nil {
				return parsed
			}
		}
	}
	return defaultValue
}

func summaryCredentialOutcome(status string) string {
	switch strings.TrimSpace(strings.ToLower(status)) {
	case StatusHealthy:
		return "success"
	case StatusCredentialInvalid:
		return "auth_failed"
	case StatusUnreachable:
		return "unreachable"
	default:
		return "unknown"
	}
}

func isCredentialAuthError(err error) bool {
	message := strings.ToLower(strings.TrimSpace(err.Error()))
	return strings.Contains(message, "wrongpass") ||
		strings.Contains(message, "noauth") ||
		strings.Contains(message, "authentication failed") ||
		strings.Contains(message, "invalid password")
}

func isConnectivityError(err error) bool {
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

func preserveStrongerFailureFromOtherCheck(app core.App, targetType, targetID, checkKind string) bool {
	record, err := app.FindFirstRecordByFilter(
		"monitor_latest_status",
		"target_type = {:targetType} && target_id = {:targetID}",
		map[string]any{"targetType": strings.TrimSpace(targetType), "targetID": strings.TrimSpace(targetID)},
	)
	if err != nil {
		return false
	}
	summary, summaryErr := SummaryFromRecord(record)
	if summaryErr != nil {
		return false
	}
	existingCheckKind := strings.TrimSpace(fmt.Sprint(summary["check_kind"]))
	return existingCheckKind != "" && !strings.EqualFold(existingCheckKind, strings.TrimSpace(checkKind))
}
