package fetchstore

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/infra/egress"
	"github.com/websoft9/appos/backend/infra/filesvc"
)

var newFetchHTTPClient = egress.NewFetchHTTPClient

type clientDoer interface {
	Do(req *http.Request) (*http.Response, error)
}

type retryableDownloadError struct {
	err error
}

func (e *retryableDownloadError) Error() string { return e.err.Error() }
func (e *retryableDownloadError) Unwrap() error { return e.err }

func Download(ctx context.Context, app core.App, service *filesvc.LocalService, req Request) (Result, error) {
	normalized, err := normalizeRequest(service, req)
	if err != nil {
		return Result{}, err
	}
	client, err := newFetchHTTPClient(app, normalized.consumerKey, normalized.timeout, false)
	if err != nil {
		return Result{}, err
	}
	return downloadWithClient(ctx, &client, normalized)
}

func downloadWithClient(ctx context.Context, client clientDoer, req normalizedRequest) (Result, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	if req.timeout > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, req.timeout)
		defer cancel()
	}

	finalPath, err := req.service.Resolve(req.destinationPath)
	if err != nil {
		return Result{}, err
	}
	if err := ensureDestinationAvailable(finalPath, req.overwrite); err != nil {
		return Result{}, err
	}
	if err := os.MkdirAll(filepath.Dir(finalPath), 0o755); err != nil {
		return Result{}, err
	}
	tempPath := finalPath + ".part"
	statePath := tempPath + ".json"

	var lastErr error
	for _, sourceURL := range req.sourceURLs {
		for attempt := 0; attempt <= req.retryCount; attempt++ {
			resumeState, hasResumeState, prepareErr := prepareSourceAttempt(ctx, client, req, sourceURL, tempPath, statePath)
			if prepareErr != nil {
				lastErr = prepareErr
			} else {
				result, attemptErr := downloadFromSource(ctx, client, req, sourceURL, finalPath, tempPath, statePath, resumeState, hasResumeState)
				if attemptErr == nil {
					return result, nil
				}
				lastErr = attemptErr
			}
			if attempt == req.retryCount || !isRetryableDownloadError(lastErr) {
				break
			}
			if err := waitRetryBackoff(ctx, req.retryBackoff, attempt); err != nil {
				return Result{}, err
			}
		}
	}
	if lastErr == nil {
		lastErr = fmt.Errorf("download failed")
	}
	return Result{}, lastErr
}

func downloadFromSource(ctx context.Context, client clientDoer, req normalizedRequest, sourceURL, finalPath, tempPath, statePath string, resumeState downloadState, canResume bool) (Result, error) {
	resumeOffset := int64(0)
	appendMode := false
	if canResume {
		resumeOffset = resumeState.BytesCompleted
	}
	emitProgress(req.progress, Progress{Phase: PhaseStarting, BytesCompleted: resumeOffset, BytesTotal: resumeState.BytesTotal, ChunkIndex: 0, ChunkCount: 1, SourceURL: sourceURL})
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, sourceURL, nil)
	if err != nil {
		return Result{}, err
	}
	if canResume && resumeOffset > 0 {
		request.Header.Set("Range", fmt.Sprintf("bytes=%d-", resumeOffset))
		if resumeState.SourceETag != "" {
			request.Header.Set("If-Range", resumeState.SourceETag)
		} else if resumeState.SourceLastModified != "" {
			request.Header.Set("If-Range", resumeState.SourceLastModified)
		}
		emitProgress(req.progress, Progress{Phase: PhaseResuming, BytesCompleted: resumeOffset, BytesTotal: resumeState.BytesTotal, ChunkIndex: 0, ChunkCount: 1, SourceURL: sourceURL})
	}
	response, err := client.Do(request)
	if err != nil {
		return Result{}, markRetryable(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK && response.StatusCode != http.StatusPartialContent {
		err := fmt.Errorf("unexpected response status: %s", response.Status)
		if isRetryableHTTPStatus(response.StatusCode) {
			return Result{}, markRetryable(err)
		}
		return Result{}, err
	}

	state := downloadState{
		SourceURL:          sourceURL,
		SourceETag:         strings.TrimSpace(response.Header.Get("ETag")),
		SourceLastModified: strings.TrimSpace(response.Header.Get("Last-Modified")),
		ExpectedSHA256:     req.expectedSHA256,
		ChunkSize:          0,
	}
	contentType := normalizeContentType(response.Header.Get("Content-Type"))
	totalBytes := int64(0)
	if response.StatusCode == http.StatusPartialContent {
		start, _, total, ok := parseContentRange(response.Header.Get("Content-Range"))
		if !ok {
			return Result{}, fmt.Errorf("invalid content-range for resumable download")
		}
		if canResume && start != resumeOffset {
			return Result{}, fmt.Errorf("unexpected resume offset: want %d got %d", resumeOffset, start)
		}
		appendMode = start > 0
		totalBytes = total
		state.BytesTotal = total
	} else if response.ContentLength > 0 {
		totalBytes = response.ContentLength
		state.BytesTotal = response.ContentLength
	}
	if req.maxBytes > 0 && state.BytesTotal > req.maxBytes {
		return Result{}, fmt.Errorf("remote content exceeds %d bytes", req.maxBytes)
	}
	if canResume && resumeOffset > 0 && response.StatusCode == http.StatusOK {
		if err := removeArtifacts(tempPath, statePath); err != nil {
			return Result{}, err
		}
		resumeOffset = 0
	}
	if !appendMode {
		if err := removeArtifacts(tempPath, statePath); err != nil && !errors.Is(err, os.ErrNotExist) {
			return Result{}, err
		}
	}
	fileFlags := os.O_CREATE | os.O_WRONLY
	if appendMode {
		fileFlags |= os.O_APPEND
	} else {
		fileFlags |= os.O_TRUNC
	}
	file, err := os.OpenFile(tempPath, fileFlags, 0o600)
	if err != nil {
		return Result{}, err
	}
	defer file.Close()

	hasher := newSHA256Hasher()
	bytesCompleted := resumeOffset
	if appendMode {
		if err := hashFileInto(tempPath, hasher); err != nil {
			return Result{}, err
		}
	} else {
		bytesCompleted = 0
	}
	state.BytesCompleted = bytesCompleted
	if err := saveState(statePath, state); err != nil {
		return Result{}, err
	}

	buffer := make([]byte, 128*1024)
	for {
		readBytes, readErr := response.Body.Read(buffer)
		if readBytes > 0 {
			written, writeErr := file.Write(buffer[:readBytes])
			if writeErr != nil {
				return Result{}, writeErr
			}
			if written != readBytes {
				return Result{}, io.ErrShortWrite
			}
			if _, err := hasher.Write(buffer[:written]); err != nil {
				return Result{}, err
			}
			bytesCompleted += int64(written)
			if req.maxBytes > 0 && bytesCompleted > req.maxBytes {
				_ = removeArtifacts(tempPath, statePath)
				return Result{}, fmt.Errorf("remote content exceeds %d bytes", req.maxBytes)
			}
			state.BytesCompleted = bytesCompleted
			if totalBytes > 0 {
				state.BytesTotal = totalBytes
			}
			if err := saveState(statePath, state); err != nil {
				return Result{}, err
			}
			emitProgress(req.progress, Progress{Phase: PhaseDownloading, BytesCompleted: bytesCompleted, BytesTotal: state.BytesTotal, ChunkIndex: 0, ChunkCount: 1, SourceURL: sourceURL})
		}
		if readErr != nil {
			if errors.Is(readErr, io.EOF) {
				break
			}
			if syncErr := file.Sync(); syncErr != nil {
				return Result{}, syncErr
			}
			return Result{}, markRetryable(readErr)
		}
	}
	if err := file.Sync(); err != nil {
		return Result{}, err
	}
	computedSHA256 := finalizeSHA256(hasher)
	emitProgress(req.progress, Progress{Phase: PhaseVerifying, BytesCompleted: bytesCompleted, BytesTotal: state.BytesTotal, ChunkIndex: 0, ChunkCount: 1, SourceURL: sourceURL})
	if req.expectedSHA256 != "" && computedSHA256 != req.expectedSHA256 {
		_ = removeArtifacts(tempPath, statePath)
		return Result{}, fmt.Errorf("sha256 mismatch: expected %s got %s", req.expectedSHA256, computedSHA256)
	}
	if err := os.Rename(tempPath, finalPath); err != nil {
		return Result{}, err
	}
	if err := os.Remove(statePath); err != nil && !errors.Is(err, os.ErrNotExist) {
		return Result{}, err
	}
	emitProgress(req.progress, Progress{Phase: PhaseCompleted, BytesCompleted: bytesCompleted, BytesTotal: state.BytesTotal, ChunkIndex: 0, ChunkCount: 1, SourceURL: sourceURL})
	return Result{Path: req.destinationPath, BytesWritten: bytesCompleted, ContentType: contentType, SHA256: computedSHA256, Resumed: appendMode, SourceURL: sourceURL}, nil
}

func prepareSourceAttempt(ctx context.Context, client clientDoer, req normalizedRequest, sourceURL, tempPath, statePath string) (downloadState, bool, error) {
	resumeState, hasResumeState, err := loadResumeState(tempPath, statePath, req)
	if err != nil {
		return downloadState{}, false, err
	}
	if !hasResumeState || resumeState.SourceURL == "" || resumeState.SourceURL == sourceURL {
		return resumeState, hasResumeState, nil
	}
	compatible, probeErr := probeSourceCompatibility(ctx, client, sourceURL, resumeState)
	if probeErr != nil {
		return downloadState{}, false, probeErr
	}
	if compatible {
		resumeState.SourceURL = sourceURL
		if err := saveState(statePath, resumeState); err != nil {
			return downloadState{}, false, err
		}
		return resumeState, true, nil
	}
	if err := removeArtifacts(tempPath, statePath); err != nil {
		return downloadState{}, false, err
	}
	return downloadState{}, false, nil
}

func probeSourceCompatibility(ctx context.Context, client clientDoer, sourceURL string, state downloadState) (bool, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodHead, sourceURL, nil)
	if err != nil {
		return false, err
	}
	response, err := client.Do(request)
	if err != nil {
		return false, markRetryable(err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		err := fmt.Errorf("compatibility probe returned %s", response.Status)
		if isRetryableHTTPStatus(response.StatusCode) {
			return false, markRetryable(err)
		}
		return false, err
	}
	matched := false
	probeETag := strings.TrimSpace(response.Header.Get("ETag"))
	if state.SourceETag != "" && probeETag != "" {
		matched = true
		if probeETag != state.SourceETag {
			return false, nil
		}
	}
	probeLastModified := strings.TrimSpace(response.Header.Get("Last-Modified"))
	if state.SourceLastModified != "" && probeLastModified != "" {
		matched = true
		if probeLastModified != state.SourceLastModified {
			return false, nil
		}
	}
	if state.BytesTotal > 0 && response.ContentLength > 0 {
		matched = true
		if response.ContentLength != state.BytesTotal {
			return false, nil
		}
	}
	return matched, nil
}

func loadResumeState(tempPath, statePath string, req normalizedRequest) (downloadState, bool, error) {
	if !req.resume {
		if err := removeArtifacts(tempPath, statePath); err != nil && !errors.Is(err, os.ErrNotExist) {
			return downloadState{}, false, err
		}
		return downloadState{}, false, nil
	}
	partInfo, err := os.Stat(tempPath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			_ = os.Remove(statePath)
			return downloadState{}, false, nil
		}
		return downloadState{}, false, err
	}
	if partInfo.IsDir() {
		return downloadState{}, false, filesvc.ErrConflict
	}
	state, err := loadState(statePath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			_ = os.Remove(tempPath)
			return downloadState{}, false, nil
		}
		return downloadState{}, false, err
	}
	if state.Version != stateVersion || state.SourceURL == "" || state.BytesCompleted != partInfo.Size() {
		if err := removeArtifacts(tempPath, statePath); err != nil {
			return downloadState{}, false, err
		}
		return downloadState{}, false, nil
	}
	if req.expectedSHA256 != "" && state.ExpectedSHA256 != req.expectedSHA256 {
		if err := removeArtifacts(tempPath, statePath); err != nil {
			return downloadState{}, false, err
		}
		return downloadState{}, false, nil
	}
	return state, true, nil
}

func ensureDestinationAvailable(finalPath string, overwrite bool) error {
	info, err := os.Stat(finalPath)
	if err == nil {
		if info.IsDir() || !overwrite {
			return filesvc.ErrConflict
		}
		return nil
	}
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}

func waitRetryBackoff(ctx context.Context, base time.Duration, attempt int) error {
	backoff := base
	for i := 0; i < attempt; i++ {
		if backoff > time.Hour/2 {
			break
		}
		backoff *= 2
	}
	timer := time.NewTimer(backoff)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

func markRetryable(err error) error {
	if err == nil {
		return nil
	}
	var existing *retryableDownloadError
	if errors.As(err, &existing) {
		return err
	}
	return &retryableDownloadError{err: err}
}

func isRetryableDownloadError(err error) bool {
	var retryable *retryableDownloadError
	if errors.As(err, &retryable) {
		return true
	}
	var netErr net.Error
	return errors.As(err, &netErr)
}

func isRetryableHTTPStatus(statusCode int) bool {
	switch statusCode {
	case http.StatusRequestTimeout, http.StatusTooEarly, http.StatusTooManyRequests,
		http.StatusInternalServerError, http.StatusBadGateway, http.StatusServiceUnavailable, http.StatusGatewayTimeout:
		return true
	default:
		return false
	}
}

func removeArtifacts(paths ...string) error {
	for _, path := range paths {
		if path == "" {
			continue
		}
		if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
	}
	return nil
}

func normalizeContentType(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	if idx := strings.Index(raw, ";"); idx >= 0 {
		raw = raw[:idx]
	}
	return strings.TrimSpace(raw)
}
