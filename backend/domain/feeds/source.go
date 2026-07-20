package feeds

import (
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"
)

const (
	CollectionSources = "feed_sources"

	FormatRSS  = "rss"
	FormatAtom = "atom"

	StatusActive   = "active"
	StatusPaused   = "paused"
	StatusArchived = "archived"

	maxLastErrorLen = 1000
)

type SourceSnapshot struct {
	ID            string
	Name          string
	URL           string
	Format        string
	Status        string
	FailureStreak int
	NextPollAt    time.Time
	LastFetchedAt time.Time
	LastSuccessAt time.Time
	LastError     string
}

type Source struct {
	rec *core.Record
}

func FromRecord(rec *core.Record) *Source {
	return &Source{rec: rec}
}

func SnapshotFromRecord(rec *core.Record) SourceSnapshot {
	if rec == nil {
		return SourceSnapshot{}
	}
	return SourceSnapshot{
		ID:            rec.Id,
		Name:          strings.TrimSpace(rec.GetString("name")),
		URL:           strings.TrimSpace(rec.GetString("url")),
		Format:        strings.TrimSpace(rec.GetString("format")),
		Status:        strings.TrimSpace(rec.GetString("status")),
		FailureStreak: rec.GetInt("failure_streak"),
		NextPollAt:    recordDateTime(rec, "next_poll_at"),
		LastFetchedAt: recordDateTime(rec, "last_fetched_at"),
		LastSuccessAt: recordDateTime(rec, "last_success_at"),
		LastError:     strings.TrimSpace(rec.GetString("last_error")),
	}
}

func (s *Source) Record() *core.Record {
	if s == nil {
		return nil
	}
	return s.rec
}

func (s *Source) Snapshot() SourceSnapshot {
	if s == nil {
		return SourceSnapshot{}
	}
	return SnapshotFromRecord(s.rec)
}

func (s *Source) ApplyConfiguration(input SourceUpsertInput) {
	if s == nil || s.rec == nil {
		return
	}

	snapshot := s.Snapshot()
	identityChanged := snapshot.URL != input.URL || snapshot.Format != input.Format

	s.rec.Set("name", input.Name)
	s.rec.Set("url", input.URL)
	s.rec.Set("favicon_url", input.FaviconURL)
	s.rec.Set("format", input.Format)
	s.rec.Set("status", input.Status)

	if identityChanged {
		s.ResetRuntimeState()
	}
}

func (s *Source) ResetRuntimeState() {
	if s == nil || s.rec == nil {
		return
	}
	s.rec.Set("last_fetched_at", types.DateTime{})
	s.rec.Set("last_success_at", types.DateTime{})
	s.rec.Set("last_error", "")
	s.rec.Set("failure_streak", 0)
	s.rec.Set("next_poll_at", types.DateTime{})
}

func (s *Source) Due(now time.Time) bool {
	if s == nil || s.rec == nil {
		return false
	}
	snapshot := s.Snapshot()
	if snapshot.Status != StatusActive {
		return false
	}
	if snapshot.NextPollAt.IsZero() {
		return true
	}
	return !now.UTC().Before(snapshot.NextPollAt)
}

func (s *Source) MarkFetchSuccess(app core.App, now time.Time) {
	if s == nil || s.rec == nil {
		return
	}
	when := mustDateTime(now.UTC())
	policy := LoadPolicySettings(app)
	s.rec.Set("last_fetched_at", when)
	s.rec.Set("last_success_at", when)
	s.rec.Set("last_error", "")
	s.rec.Set("failure_streak", 0)
	s.rec.Set("next_poll_at", mustDateTime(nextScheduledPollAt(now.UTC(), policy)))
}

func (s *Source) MarkFetchFailure(app core.App, now time.Time, msg string) {
	if s == nil || s.rec == nil {
		return
	}
	streak := s.rec.GetInt("failure_streak") + 1
	timestamp := now.UTC()
	policy := LoadPolicySettings(app)
	s.rec.Set("last_fetched_at", mustDateTime(timestamp))
	s.rec.Set("last_error", normalizeLastError(msg))
	s.rec.Set("failure_streak", streak)
	s.rec.Set("next_poll_at", mustDateTime(nextPollAtForFailure(timestamp, streak, policy)))
}

func nextScheduledPollAt(now time.Time, policy PolicySettings) time.Time {
	if policy.PollInterval <= 0 {
		policy = DefaultPolicySettings()
	}
	return now.UTC().Add(policy.PollInterval)
}

func nextPollAtForFailure(now time.Time, streak int, policy PolicySettings) time.Time {
	switch {
	case streak <= 1:
		return now.UTC().Add(policy.FailureBackoffOne)
	case streak == 2:
		return now.UTC().Add(policy.FailureBackoffTwo)
	default:
		return now.UTC().Add(policy.FailureBackoffMax)
	}
}

func normalizeLastError(msg string) string {
	trimmed := strings.TrimSpace(msg)
	if len(trimmed) <= maxLastErrorLen {
		return trimmed
	}
	return trimmed[:maxLastErrorLen]
}

func recordDateTime(record *core.Record, field string) time.Time {
	if record == nil {
		return time.Time{}
	}
	value := record.GetDateTime(field)
	if value.IsZero() {
		return time.Time{}
	}
	return value.Time().UTC()
}

func mustDateTime(value time.Time) types.DateTime {
	parsed, err := types.ParseDateTime(value.UTC().Format(time.RFC3339))
	if err != nil {
		panic(err)
	}
	return parsed
}
