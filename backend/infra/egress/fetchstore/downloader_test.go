package fetchstore

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/infra/filesvc"
)

func TestDownloadWritesFileAndReportsProgress(t *testing.T) {
	svc := newService(t)
	body := []byte("hello fetchstore")
	expectedSHA := sha256Hex(body)
	transport := &rangeTransport{body: body}
	restore := overrideFetchClient(t, transport)
	defer restore()

	progressEvents := make([]Progress, 0, 4)
	result, err := Download(context.Background(), nil, svc, Request{
		ConsumerKey:     "download.general",
		URL:             "https://example.com/file.txt",
		DestinationPath: "downloads/file.txt",
		ExpectedSHA256:  expectedSHA,
		Progress: func(progress Progress) {
			progressEvents = append(progressEvents, progress)
		},
	})
	if err != nil {
		t.Fatalf("Download: %v", err)
	}
	if result.Path != "downloads/file.txt" || result.BytesWritten != int64(len(body)) || result.SHA256 != expectedSHA {
		t.Fatalf("unexpected result: %#v", result)
	}
	data, _, err := svc.ReadFile("downloads/file.txt")
	if err != nil {
		t.Fatalf("ReadFile: %v", err)
	}
	if string(data) != string(body) {
		t.Fatalf("unexpected file content: %q", string(data))
	}
	if len(progressEvents) < 3 {
		t.Fatalf("expected progress events, got %#v", progressEvents)
	}
	if progressEvents[len(progressEvents)-1].Phase != PhaseCompleted {
		t.Fatalf("expected final phase completed, got %#v", progressEvents[len(progressEvents)-1])
	}
	if _, err := svc.Stat("downloads/file.txt.part"); !errors.Is(err, filesvc.ErrNotFound) {
		t.Fatalf("expected no temp artifact, got %v", err)
	}
}

func TestDownloadResumesPartialFile(t *testing.T) {
	svc := newService(t)
	body := []byte("resume-me-please")
	expectedSHA := sha256Hex(body)
	transport := &rangeTransport{body: body, failAfterBytesOnce: 6}
	restore := overrideFetchClient(t, transport)
	defer restore()

	_, err := Download(context.Background(), nil, svc, Request{
		ConsumerKey:     "download.general",
		URL:             "https://example.com/archive.tgz",
		DestinationPath: "downloads/archive.tgz",
		ExpectedSHA256:  expectedSHA,
		Resume:          true,
	})
	if err == nil {
		t.Fatal("expected first download attempt to fail")
	}
	if !strings.Contains(err.Error(), "forced body failure") {
		t.Fatalf("unexpected first error: %v", err)
	}

	result, err := Download(context.Background(), nil, svc, Request{
		ConsumerKey:     "download.general",
		URL:             "https://example.com/archive.tgz",
		DestinationPath: "downloads/archive.tgz",
		ExpectedSHA256:  expectedSHA,
		Resume:          true,
	})
	if err != nil {
		t.Fatalf("Download resume: %v", err)
	}
	if !result.Resumed {
		t.Fatalf("expected resumed result, got %#v", result)
	}
	data, _, err := svc.ReadFile("downloads/archive.tgz")
	if err != nil {
		t.Fatalf("ReadFile: %v", err)
	}
	if string(data) != string(body) {
		t.Fatalf("unexpected resumed content: %q", string(data))
	}
	if len(transport.ranges) < 2 {
		t.Fatalf("expected at least two HTTP requests, got %#v", transport.ranges)
	}
	if got := transport.ranges[len(transport.ranges)-1]; got != "bytes=6-" {
		t.Fatalf("expected resume range bytes=6-, got %q", got)
	}
}

func TestDownloadRejectsChecksumMismatchAndCleansArtifacts(t *testing.T) {
	svc := newService(t)
	transport := &rangeTransport{body: []byte("wrong")}
	restore := overrideFetchClient(t, transport)
	defer restore()

	_, err := Download(context.Background(), nil, svc, Request{
		ConsumerKey:     "download.general",
		URL:             "https://example.com/bad.bin",
		DestinationPath: "downloads/bad.bin",
		ExpectedSHA256:  strings.Repeat("a", 64),
	})
	if err == nil || !strings.Contains(err.Error(), "sha256 mismatch") {
		t.Fatalf("expected checksum mismatch, got %v", err)
	}
	if _, err := svc.Stat("downloads/bad.bin"); !errors.Is(err, filesvc.ErrNotFound) {
		t.Fatalf("expected no final file, got %v", err)
	}
	finalAbs, err := svc.Resolve("downloads/bad.bin")
	if err != nil {
		t.Fatal(err)
	}
	if _, statErr := os.Stat(finalAbs + ".part"); !errors.Is(statErr, os.ErrNotExist) {
		t.Fatalf("expected temp file cleanup, got %v", statErr)
	}
	if _, statErr := os.Stat(finalAbs + ".part.json"); !errors.Is(statErr, os.ErrNotExist) {
		t.Fatalf("expected state cleanup, got %v", statErr)
	}
}

func TestDownloadFallsBackToMirrorBeforeAnyBytesPersist(t *testing.T) {
	svc := newService(t)
	body := []byte("mirror payload")
	transport := &rangeTransport{body: body, failURLs: map[string]error{"https://primary.example.com/file.bin": fmt.Errorf("primary unavailable")}}
	restore := overrideFetchClient(t, transport)
	defer restore()

	result, err := Download(context.Background(), nil, svc, Request{
		ConsumerKey:     "download.general",
		URL:             "https://primary.example.com/file.bin",
		DestinationPath: "downloads/file.bin",
		Mirrors:         []string{"https://mirror.example.com/file.bin"},
	})
	if err != nil {
		t.Fatalf("Download with mirror: %v", err)
	}
	if result.SourceURL != "https://mirror.example.com/file.bin" {
		t.Fatalf("expected mirror source, got %#v", result)
	}
}

func TestDownloadRetriesTransientRequestErrors(t *testing.T) {
	svc := newService(t)
	body := []byte("retry payload")
	transport := &rangeTransport{
		body:     body,
		failURLs: map[string]error{"https://example.com/retry.bin": fmt.Errorf("temporary network failure")},
	}
	restore := overrideFetchClient(t, transport)
	defer restore()

	result, err := Download(context.Background(), nil, svc, Request{
		ConsumerKey:     "download.general",
		URL:             "https://example.com/retry.bin",
		DestinationPath: "downloads/retry.bin",
		RetryCount:      1,
		RetryBackoff:    time.Millisecond,
	})
	if err != nil {
		t.Fatalf("Download retry: %v", err)
	}
	if result.BytesWritten != int64(len(body)) {
		t.Fatalf("unexpected retry result: %#v", result)
	}
	if transport.requestCount("GET https://example.com/retry.bin") != 2 {
		t.Fatalf("expected two GET attempts, got %#v", transport.requestKeys)
	}
	data, _, err := svc.ReadFile("downloads/retry.bin")
	if err != nil || string(data) != string(body) {
		t.Fatalf("unexpected retried file: %q err=%v", string(data), err)
	}
}

func TestDownloadResumesFromCompatibleMirrorAfterPartialPersistence(t *testing.T) {
	svc := newService(t)
	body := []byte("resume across mirror")
	expectedSHA := sha256Hex(body)
	transport := &rangeTransport{body: body, failAfterBytesOnce: 6}
	restore := overrideFetchClient(t, transport)
	defer restore()

	result, err := Download(context.Background(), nil, svc, Request{
		ConsumerKey:     "download.general",
		URL:             "https://primary.example.com/file.bin",
		DestinationPath: "downloads/file.bin",
		ExpectedSHA256:  expectedSHA,
		Resume:          true,
		Mirrors:         []string{"https://mirror.example.com/file.bin"},
		RetryCount:      0,
	})
	if err != nil {
		t.Fatalf("Download compatible mirror resume: %v", err)
	}
	if !result.Resumed || result.SourceURL != "https://mirror.example.com/file.bin" {
		t.Fatalf("expected resumed mirror result, got %#v", result)
	}
	if !transport.sawRange("bytes=6-") {
		t.Fatalf("expected resume range request, got %#v", transport.ranges)
	}
	if transport.requestCount("HEAD https://mirror.example.com/file.bin") == 0 {
		t.Fatalf("expected mirror compatibility HEAD probe, got %#v", transport.requestKeys)
	}
}

func TestDownloadRejectsExistingDestinationWithoutOverwrite(t *testing.T) {
	svc := newService(t)
	entry, err := svc.WriteFile("downloads/existing.bin", []byte("keep"), false)
	if err != nil || entry.Path == "" {
		t.Fatalf("WriteFile setup: %v %#v", err, entry)
	}
	transport := &rangeTransport{body: []byte("new")}
	restore := overrideFetchClient(t, transport)
	defer restore()

	_, err = Download(context.Background(), nil, svc, Request{
		ConsumerKey:     "download.general",
		URL:             "https://example.com/existing.bin",
		DestinationPath: "downloads/existing.bin",
	})
	if !errors.Is(err, filesvc.ErrConflict) {
		t.Fatalf("expected conflict, got %v", err)
	}
}

func TestDownloadRejectsContentAboveMaxBytes(t *testing.T) {
	svc := newService(t)
	transport := &rangeTransport{body: []byte("123456")}
	restore := overrideFetchClient(t, transport)
	defer restore()

	_, err := Download(context.Background(), nil, svc, Request{
		ConsumerKey:     "download.general",
		URL:             "https://example.com/too-large.bin",
		DestinationPath: "downloads/too-large.bin",
		MaxBytes:        5,
	})
	if err == nil || !strings.Contains(err.Error(), "exceeds 5 bytes") {
		t.Fatalf("expected max-bytes error, got %v", err)
	}
}

func newService(t *testing.T) *filesvc.LocalService {
	t.Helper()
	base := t.TempDir()
	svc, err := filesvc.NewLocal(filesvc.Config{BasePath: base, AllowedRoots: []string{"downloads"}})
	if err != nil {
		t.Fatalf("NewLocal: %v", err)
	}
	return svc
}

func overrideFetchClient(t *testing.T, transport http.RoundTripper) func() {
	t.Helper()
	original := newFetchHTTPClient
	newFetchHTTPClient = func(_ core.App, _ string, timeout time.Duration, _ bool) (http.Client, error) {
		return http.Client{Transport: transport, Timeout: timeout}, nil
	}
	return func() {
		newFetchHTTPClient = original
	}
}

type rangeTransport struct {
	body               []byte
	failAfterBytesOnce int
	failOnce           bool
	failURLs           map[string]error
	statusByURL        map[string][]int
	mu                 sync.Mutex
	ranges             []string
	requestKeys        []string
}

func (rt *rangeTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	rt.mu.Lock()
	defer rt.mu.Unlock()
	rt.ranges = append(rt.ranges, req.Header.Get("Range"))
	requestKey := req.Method + " " + req.URL.String()
	rt.requestKeys = append(rt.requestKeys, requestKey)
	if err, ok := rt.failURLs[req.URL.String()]; ok {
		delete(rt.failURLs, req.URL.String())
		return nil, err
	}
	start := 0
	status := http.StatusOK
	if seq := rt.statusByURL[req.URL.String()]; len(seq) > 0 {
		status = seq[0]
		rt.statusByURL[req.URL.String()] = seq[1:]
	}
	headers := make(http.Header)
	headers.Set("ETag", `"etag-demo"`)
	headers.Set("Last-Modified", time.Unix(1719398400, 0).UTC().Format(http.TimeFormat))
	if rangeHeader := req.Header.Get("Range"); rangeHeader != "" {
		if strings.HasPrefix(rangeHeader, "bytes=") && strings.HasSuffix(rangeHeader, "-") {
			_, err := fmt.Sscanf(strings.TrimSuffix(strings.TrimPrefix(rangeHeader, "bytes="), "-"), "%d", &start)
			if err != nil {
				return nil, err
			}
			status = http.StatusPartialContent
			headers.Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", start, len(rt.body)-1, len(rt.body)))
		}
	}
	payload := append([]byte(nil), rt.body[start:]...)
	var body io.ReadCloser = io.NopCloser(bytes.NewReader(payload))
	if rt.failAfterBytesOnce > 0 && !rt.failOnce {
		limit := rt.failAfterBytesOnce
		if start > 0 {
			limit -= start
		}
		if limit < 0 {
			limit = 0
		}
		body = &failingReadCloser{data: payload, failAfter: limit, err: fmt.Errorf("forced body failure")}
		rt.failOnce = true
	}
	response := &http.Response{
		StatusCode:    status,
		Status:        fmt.Sprintf("%d %s", status, http.StatusText(status)),
		Header:        headers,
		Body:          body,
		ContentLength: int64(len(payload)),
		Request:       req,
	}
	return response, nil
}

func (rt *rangeTransport) requestCount(key string) int {
	rt.mu.Lock()
	defer rt.mu.Unlock()
	count := 0
	for _, item := range rt.requestKeys {
		if item == key {
			count++
		}
	}
	return count
}

func (rt *rangeTransport) sawRange(value string) bool {
	rt.mu.Lock()
	defer rt.mu.Unlock()
	for _, item := range rt.ranges {
		if item == value {
			return true
		}
	}
	return false
}

type failingReadCloser struct {
	data      []byte
	offset    int
	failAfter int
	err       error
}

func (rc *failingReadCloser) Read(p []byte) (int, error) {
	if rc.offset >= len(rc.data) {
		return 0, io.EOF
	}
	if rc.failAfter >= 0 && rc.offset >= rc.failAfter {
		return 0, rc.err
	}
	limit := len(rc.data)
	if rc.failAfter >= 0 && rc.failAfter < limit {
		limit = rc.failAfter
	}
	remaining := limit - rc.offset
	if remaining <= 0 {
		return 0, rc.err
	}
	if remaining < len(p) {
		p = p[:remaining]
	}
	n := copy(p, rc.data[rc.offset:limit])
	rc.offset += n
	if rc.offset >= len(rc.data) {
		return n, io.EOF
	}
	if rc.failAfter >= 0 && rc.offset >= rc.failAfter {
		return n, rc.err
	}
	return n, nil
}

func (rc *failingReadCloser) Close() error {
	return nil
}

func sha256Hex(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}
