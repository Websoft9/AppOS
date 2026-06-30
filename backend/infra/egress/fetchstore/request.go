package fetchstore

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/websoft9/appos/backend/infra/egress"
	"github.com/websoft9/appos/backend/infra/filesvc"
)

type Request struct {
	ConsumerKey     string
	URL             string
	DestinationPath string
	Overwrite       bool
	MaxBytes        int64
	ExpectedSHA256  string
	Timeout         time.Duration
	Resume          bool
	Mirrors         []string
	RetryCount      int
	RetryBackoff    time.Duration
	Progress        func(Progress)
}

type Result struct {
	Path         string
	BytesWritten int64
	ContentType  string
	SHA256       string
	Resumed      bool
	SourceURL    string
}

type normalizedRequest struct {
	consumerKey     string
	primaryURL      string
	sourceURLs      []string
	destinationPath string
	overwrite       bool
	maxBytes        int64
	expectedSHA256  string
	timeout         time.Duration
	resume          bool
	progress        func(Progress)
	retryCount      int
	retryBackoff    time.Duration
	service         *filesvc.LocalService
}

func normalizeRequest(service *filesvc.LocalService, req Request) (normalizedRequest, error) {
	if service == nil {
		return normalizedRequest{}, fmt.Errorf("service is required")
	}
	if service.ReadOnly() {
		return normalizedRequest{}, filesvc.ErrReadOnly
	}
	consumerKey := strings.TrimSpace(req.ConsumerKey)
	if consumerKey == "" {
		return normalizedRequest{}, fmt.Errorf("consumer key is required")
	}
	destinationPath := strings.TrimSpace(req.DestinationPath)
	if destinationPath == "" {
		return normalizedRequest{}, fmt.Errorf("destination path is required")
	}
	if _, err := service.Resolve(destinationPath); err != nil {
		return normalizedRequest{}, err
	}
	primaryURL, err := normalizeSourceURL(req.URL)
	if err != nil {
		return normalizedRequest{}, err
	}
	sources := []string{primaryURL}
	seen := map[string]struct{}{primaryURL: {}}
	for _, mirror := range req.Mirrors {
		normalized, err := normalizeSourceURL(mirror)
		if err != nil {
			return normalizedRequest{}, err
		}
		if _, exists := seen[normalized]; exists {
			continue
		}
		seen[normalized] = struct{}{}
		sources = append(sources, normalized)
	}
	checksum := strings.ToLower(strings.TrimSpace(req.ExpectedSHA256))
	if checksum != "" {
		decoded, err := hex.DecodeString(checksum)
		if err != nil || len(decoded) != sha256.Size {
			return normalizedRequest{}, fmt.Errorf("expected sha256 must be a %d-byte hex string", sha256.Size)
		}
	}
	return normalizedRequest{
		consumerKey:     consumerKey,
		primaryURL:      primaryURL,
		sourceURLs:      sources,
		destinationPath: destinationPath,
		overwrite:       req.Overwrite,
		maxBytes:        req.MaxBytes,
		expectedSHA256:  checksum,
		timeout:         req.Timeout,
		resume:          req.Resume,
		progress:        req.Progress,
		retryCount:      normalizeRetryCount(req.RetryCount),
		retryBackoff:    normalizeRetryBackoff(req.RetryBackoff),
		service:         service,
	}, nil
}

func normalizeRetryCount(count int) int {
	if count < 0 {
		return 0
	}
	return count
}

func normalizeRetryBackoff(backoff time.Duration) time.Duration {
	if backoff <= 0 {
		return 250 * time.Millisecond
	}
	return backoff
}

func normalizeSourceURL(rawURL string) (string, error) {
	trimmed := strings.TrimSpace(rawURL)
	if trimmed == "" {
		return "", fmt.Errorf("source URL is required")
	}
	parsed, err := egress.ValidateFetchURL(trimmed)
	if err != nil {
		return "", err
	}
	clone := *parsed
	clone.Fragment = ""
	return clone.String(), nil
}

func parseContentRange(header string) (start, end, total int64, ok bool) {
	header = strings.TrimSpace(header)
	if !strings.HasPrefix(header, "bytes ") {
		return 0, 0, 0, false
	}
	rangeAndTotal := strings.TrimPrefix(header, "bytes ")
	parts := strings.Split(rangeAndTotal, "/")
	if len(parts) != 2 || parts[1] == "*" {
		return 0, 0, 0, false
	}
	totalVal, err := strconv.ParseInt(parts[1], 10, 64)
	if err != nil {
		return 0, 0, 0, false
	}
	rangeParts := strings.Split(parts[0], "-")
	if len(rangeParts) != 2 {
		return 0, 0, 0, false
	}
	startVal, err := strconv.ParseInt(rangeParts[0], 10, 64)
	if err != nil {
		return 0, 0, 0, false
	}
	endVal, err := strconv.ParseInt(rangeParts[1], 10, 64)
	if err != nil {
		return 0, 0, 0, false
	}
	if startVal < 0 || endVal < startVal || totalVal <= endVal {
		return 0, 0, 0, false
	}
	return startVal, endVal, totalVal, true
}
