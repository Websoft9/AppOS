package copilot

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/websoft9/appos/backend/infra/egress"
)

func IsOpenRouterEndpoint(endpoint string) bool {
	return strings.Contains(strings.ToLower(strings.TrimSpace(endpoint)), "openrouter.ai")
}

func ValidateOpenRouterCredential(ctx context.Context, client *http.Client, endpoint string, headers map[string]string, apiKey string) error {
	if strings.TrimSpace(apiKey) == "" {
		return nil
	}
	endpoint = strings.TrimSpace(endpoint)
	if endpoint == "" {
		return fmt.Errorf("OpenRouter endpoint is required")
	}
	directErr := validateOpenRouterCredentialWithClient(ctx, newDirectOpenRouterValidationClient(), endpoint, headers, apiKey)
	if directErr == nil || isOpenRouterCredentialRejected(directErr) {
		return directErr
	}
	if client == nil {
		return directErr
	}
	proxyErr := validateOpenRouterCredentialWithClient(ctx, client, endpoint, headers, apiKey)
	if proxyErr == nil || isOpenRouterCredentialRejected(proxyErr) {
		return proxyErr
	}
	return proxyErr
}

func validateOpenRouterCredentialWithClient(ctx context.Context, client *http.Client, endpoint string, headers map[string]string, apiKey string) error {
	authURL := strings.TrimRight(endpoint, "/") + "/auth/key"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, authURL, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Authorization", "Bearer "+apiKey)
	for key, value := range headers {
		if strings.TrimSpace(value) != "" {
			req.Header.Set(key, value)
		}
	}

	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusOK {
		return nil
	}
	bodyBytes, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
	bodyText := strings.TrimSpace(string(bodyBytes))
	if strings.Contains(strings.ToLower(bodyText), "user not found") || resp.StatusCode == http.StatusUnauthorized {
		return fmt.Errorf("OpenRouter authentication failed on /auth/key: upstream returned 401 User not found")
	}
	if bodyText == "" {
		return fmt.Errorf("OpenRouter authentication failed on /auth/key: status %d", resp.StatusCode)
	}
	return fmt.Errorf("OpenRouter authentication failed on /auth/key: %s", bodyText)
}

func newDirectOpenRouterValidationClient() *http.Client {
	client := egress.NewDirectHTTPClient(15*time.Second, false)
	return &client
}

func isOpenRouterCredentialRejected(err error) bool {
	if err == nil {
		return false
	}
	return strings.Contains(strings.ToLower(err.Error()), "401 user not found")
}
