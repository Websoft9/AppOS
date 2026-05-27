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
	ID                  string
	Name                string
	URL                 string
	Format              string
	Status              string
	PollIntervalMinutes int
	LastFetchedAt       time.Time
	LastSuccessAt       time.Time
	LastError           string
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
		ID:                  rec.Id,
		Name:                strings.TrimSpace(rec.GetString("name")),
		URL:                 strings.TrimSpace(rec.GetString("url")),
		Format:              strings.TrimSpace(rec.GetString("format")),
		Status:              strings.TrimSpace(rec.GetString("status")),
		PollIntervalMinutes: rec.GetInt("poll_interval_minutes"),
		LastFetchedAt:       recordDateTime(rec, "last_fetched_at"),
		LastSuccessAt:       recordDateTime(rec, "last_success_at"),
		LastError:           strings.TrimSpace(rec.GetString("last_error")),
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

func (s *Source) Due(now time.Time) bool {
	if s == nil || s.rec == nil {
		return false
	}
	snapshot := s.Snapshot()
	if snapshot.Status != StatusActive || snapshot.PollIntervalMinutes <= 0 {
		return false
	}
	if snapshot.LastFetchedAt.IsZero() {
		return true
	}
	return !now.UTC().Before(snapshot.LastFetchedAt.Add(time.Duration(snapshot.PollIntervalMinutes) * time.Minute))
}

func (s *Source) MarkFetchSuccess(now time.Time) {
	if s == nil || s.rec == nil {
		return
	}
	when := mustDateTime(now.UTC())
	s.rec.Set("last_fetched_at", when)
	s.rec.Set("last_success_at", when)
	s.rec.Set("last_error", "")
}

func (s *Source) MarkFetchFailure(now time.Time, msg string) {
	if s == nil || s.rec == nil {
		return
	}
	s.rec.Set("last_fetched_at", mustDateTime(now.UTC()))
	s.rec.Set("last_error", normalizeLastError(msg))
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