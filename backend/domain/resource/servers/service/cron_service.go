package service

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"strings"

	"github.com/google/uuid"
	"github.com/robfig/cron/v3"
)

const (
	ManagedCronMarkerPrefix = "# APPOS-CRON "
	ManagedCronRegistryPath = "/appos/data/system/crontab/managed-registry.json"
	ManagedCronRuntimeDir   = "/etc/cron.d"
	ManagedCronFilePrefix   = "appos-managed-cron-"
	ManagedCronRunUser      = "root"
	MaxManagedCronNameLen   = 64
	MaxManagedCronCmdLen    = 2048
)

var (
	managedCronScheduleParser = cron.NewParser(cron.Minute | cron.Hour | cron.Dom | cron.Month | cron.Dow)
	ErrManagedCronNotFound    = errors.New("managed cron entry not found")
)

type ManagedCronService struct {
	Repository ManagedCronRepository
}

type ManagedCronJob struct {
	EntryID       string `json:"entryId"`
	Name          string `json:"name"`
	Schedule      string `json:"schedule"`
	Command       string `json:"command"`
	Path          string `json:"path"`
	Enabled       bool   `json:"enabled"`
	SingleRunOnly bool   `json:"singleRunOnly"`
	Source        string `json:"source"`
}

type ManagedCronRegistryDocument struct {
	Jobs []ManagedCronJob `json:"jobs"`
}

type managedCronMeta struct {
	ID      string `json:"id"`
	NameB64 string `json:"name_b64"`
}

type ManagedCrontabSegment struct {
	RawLines []string
	Job      *ManagedCronJob
}

type ManagedCrontabDocument struct {
	Segments []ManagedCrontabSegment
}

func NewManagedCronJob(name, schedule, command string, enabled, singleRunOnly bool) (ManagedCronJob, error) {
	trimmedName := strings.TrimSpace(name)
	if trimmedName == "" {
		return ManagedCronJob{}, fmt.Errorf("name required")
	}
	if len(trimmedName) > MaxManagedCronNameLen {
		return ManagedCronJob{}, fmt.Errorf("name too long (max %d characters)", MaxManagedCronNameLen)
	}

	normalizedSchedule := strings.Join(strings.Fields(schedule), " ")
	if _, err := managedCronScheduleParser.Parse(normalizedSchedule); err != nil {
		return ManagedCronJob{}, fmt.Errorf("invalid cron expression")
	}

	trimmedCommand := strings.TrimSpace(command)
	if trimmedCommand == "" {
		return ManagedCronJob{}, fmt.Errorf("command required")
	}
	if len(trimmedCommand) > MaxManagedCronCmdLen {
		return ManagedCronJob{}, fmt.Errorf("command too long (max %d characters)", MaxManagedCronCmdLen)
	}
	if strings.ContainsAny(trimmedCommand, "\r\n") {
		return ManagedCronJob{}, fmt.Errorf("command must be single-line")
	}

	return ManagedCronJob{
		Name:          trimmedName,
		Schedule:      normalizedSchedule,
		Command:       trimmedCommand,
		Enabled:       enabled,
		SingleRunOnly: singleRunOnly,
		Source:        "managed",
	}, nil
}

func NewManagedCronEntryID() string {
	return "cron_" + strings.ReplaceAll(uuid.NewString(), "-", "")[:16]
}

func (s ManagedCronService) List(ctx context.Context) ([]ManagedCronJob, error) {
	doc, err := s.Repository.Load(ctx)
	if err != nil {
		return nil, err
	}
	return doc.Items(), nil
}

func (s ManagedCronService) Get(ctx context.Context, entryID string) (ManagedCronJob, error) {
	doc, err := s.Repository.Load(ctx)
	if err != nil {
		return ManagedCronJob{}, err
	}
	index := doc.FindIndex(entryID)
	if index < 0 {
		return ManagedCronJob{}, ErrManagedCronNotFound
	}
	return cloneManagedCronJob(doc.Jobs[index]), nil
}

func (s ManagedCronService) Create(ctx context.Context, job ManagedCronJob) (ManagedCronJob, string, error) {
	doc, err := s.Repository.Load(ctx)
	if err != nil {
		return ManagedCronJob{}, "", err
	}
	if strings.TrimSpace(job.EntryID) == "" {
		job.EntryID = NewManagedCronEntryID()
	}
	job = normalizeLoadedManagedCronJob(job)
	doc.Append(job)
	output, err := s.Repository.Write(ctx, doc)
	if err != nil {
		return ManagedCronJob{}, output, err
	}
	return job, output, nil
}

func (s ManagedCronService) Update(ctx context.Context, job ManagedCronJob) (ManagedCronJob, string, error) {
	doc, err := s.Repository.Load(ctx)
	if err != nil {
		return ManagedCronJob{}, "", err
	}
	index := doc.FindIndex(job.EntryID)
	if index < 0 {
		return ManagedCronJob{}, "", ErrManagedCronNotFound
	}
	job = normalizeLoadedManagedCronJob(job)
	doc.Jobs[index] = cloneManagedCronJob(job)
	output, err := s.Repository.Write(ctx, doc)
	if err != nil {
		return ManagedCronJob{}, output, err
	}
	return job, output, nil
}

func (s ManagedCronService) Toggle(ctx context.Context, entryID string, enabled bool) (ManagedCronJob, string, error) {
	doc, err := s.Repository.Load(ctx)
	if err != nil {
		return ManagedCronJob{}, "", err
	}
	index := doc.FindIndex(entryID)
	if index < 0 {
		return ManagedCronJob{}, "", ErrManagedCronNotFound
	}
	doc.Jobs[index].Enabled = enabled
	output, err := s.Repository.Write(ctx, doc)
	if err != nil {
		return ManagedCronJob{}, output, err
	}
	return doc.Jobs[index], output, nil
}

func (s ManagedCronService) Delete(ctx context.Context, entryID string) (string, error) {
	doc, err := s.Repository.Load(ctx)
	if err != nil {
		return "", err
	}
	if !doc.Remove(entryID) {
		return "", ErrManagedCronNotFound
	}
	return s.Repository.Write(ctx, doc)
}

func ParseManagedCronRegistry(raw string) (ManagedCronRegistryDocument, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return ManagedCronRegistryDocument{}, nil
	}
	var doc ManagedCronRegistryDocument
	if err := json.Unmarshal([]byte(trimmed), &doc); err != nil {
		return ManagedCronRegistryDocument{}, fmt.Errorf("invalid managed cron registry: %w", err)
	}
	for index := range doc.Jobs {
		doc.Jobs[index] = normalizeLoadedManagedCronJob(doc.Jobs[index])
	}
	return doc, nil
}

func ParseManagedCrontab(raw string) ManagedCrontabDocument {
	if raw == "" {
		return ManagedCrontabDocument{}
	}
	lines := strings.Split(strings.ReplaceAll(raw, "\r\n", "\n"), "\n")
	doc := ManagedCrontabDocument{}
	for index := 0; index < len(lines); index++ {
		line := lines[index]
		meta, ok := parseManagedCronMetaLine(line)
		if !ok || index+1 >= len(lines) {
			doc.Segments = append(doc.Segments, ManagedCrontabSegment{RawLines: []string{line}})
			continue
		}

		job, ok := parseManagedCronJob(meta, lines[index+1])
		if !ok {
			doc.Segments = append(doc.Segments, ManagedCrontabSegment{RawLines: []string{line}})
			continue
		}

		doc.Segments = append(doc.Segments, ManagedCrontabSegment{Job: job})
		index++
	}
	return doc
}

func SplitCronSpec(line string) (string, string, error) {
	trimmed := strings.TrimSpace(line)
	if trimmed == "" {
		return "", "", fmt.Errorf("empty cron line")
	}

	fields := make([]string, 0, 5)
	index := 0
	for len(fields) < 5 {
		for index < len(trimmed) && (trimmed[index] == ' ' || trimmed[index] == '\t') {
			index++
		}
		if index >= len(trimmed) {
			return "", "", fmt.Errorf("schedule requires five fields")
		}
		start := index
		for index < len(trimmed) && trimmed[index] != ' ' && trimmed[index] != '\t' {
			index++
		}
		fields = append(fields, trimmed[start:index])
	}
	for index < len(trimmed) && (trimmed[index] == ' ' || trimmed[index] == '\t') {
		index++
	}
	command := strings.TrimSpace(trimmed[index:])
	if command == "" {
		return "", "", fmt.Errorf("command required")
	}
	return strings.Join(fields, " "), command, nil
}

func (d ManagedCronRegistryDocument) Render() string {
	if len(d.Jobs) == 0 {
		return "{\"jobs\":[]}\n"
	}
	encoded, err := json.MarshalIndent(struct {
		Jobs []ManagedCronJob `json:"jobs"`
	}{Jobs: d.Jobs}, "", "  ")
	if err != nil {
		return "{\"jobs\":[]}\n"
	}
	return string(encoded) + "\n"
}

func (d *ManagedCrontabDocument) Append(job ManagedCronJob) {
	d.Segments = append(d.Segments, ManagedCrontabSegment{Job: cloneManagedCronJobPtr(job)})
}

func (d *ManagedCrontabDocument) Find(entryID string) *ManagedCrontabSegment {
	for index := range d.Segments {
		if d.Segments[index].Job != nil && d.Segments[index].Job.EntryID == entryID {
			return &d.Segments[index]
		}
	}
	return nil
}

func (d *ManagedCrontabDocument) Remove(entryID string) bool {
	for index := range d.Segments {
		if d.Segments[index].Job != nil && d.Segments[index].Job.EntryID == entryID {
			d.Segments = append(d.Segments[:index], d.Segments[index+1:]...)
			return true
		}
	}
	return false
}

func (d ManagedCrontabDocument) Items() []ManagedCronJob {
	items := make([]ManagedCronJob, 0)
	for _, segment := range d.Segments {
		if segment.Job == nil {
			continue
		}
		items = append(items, cloneManagedCronJob(*segment.Job))
	}
	return items
}

func (d ManagedCrontabDocument) Render() string {
	lines := make([]string, 0)
	for _, segment := range d.Segments {
		if segment.Job == nil {
			lines = append(lines, segment.RawLines...)
			continue
		}
		lines = append(lines, renderManagedCronBlock(*segment.Job)...)
	}
	return strings.Join(lines, "\n")
}

func (d *ManagedCronRegistryDocument) Append(job ManagedCronJob) {
	d.Jobs = append(d.Jobs, cloneManagedCronJob(job))
}

func (d ManagedCronRegistryDocument) FindIndex(entryID string) int {
	for index := range d.Jobs {
		if d.Jobs[index].EntryID == entryID {
			return index
		}
	}
	return -1
}

func (d *ManagedCronRegistryDocument) Remove(entryID string) bool {
	index := d.FindIndex(entryID)
	if index < 0 {
		return false
	}
	d.Jobs = append(d.Jobs[:index], d.Jobs[index+1:]...)
	return true
}

func (d ManagedCronRegistryDocument) Items() []ManagedCronJob {
	items := make([]ManagedCronJob, 0, len(d.Jobs))
	for _, job := range d.Jobs {
		items = append(items, cloneManagedCronJob(job))
	}
	return items
}

func ManagedCronFileName(entryID string) string {
	return ManagedCronFilePrefix + strings.TrimSpace(entryID)
}

func ManagedCronFilePath(entryID string) string {
	return filepath.Join(ManagedCronRuntimeDir, ManagedCronFileName(entryID))
}

func RenderManagedCronFile(job ManagedCronJob) string {
	lines := []string{
		"# Managed by AppOS",
		fmt.Sprintf("# entry_id=%s", job.EntryID),
		"SHELL=/bin/sh",
		"PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
		fmt.Sprintf("%s %s %s", job.Schedule, ManagedCronRunUser, renderManagedCronCommand(job)),
	}
	return strings.Join(lines, "\n") + "\n"
}

func renderManagedCronCommand(job ManagedCronJob) string {
	if !job.SingleRunOnly {
		return job.Command
	}
	wrapped := fmt.Sprintf("%s; status=$?; rm -f %s; exit $status", job.Command, ManagedCronFilePath(job.EntryID))
	return fmt.Sprintf("/bin/sh -lc %s", shellQuote(wrapped))
}

func RenderManagedCronTestCommand(job ManagedCronJob) string {
	return fmt.Sprintf("/bin/sh -lc %s", shellQuote(job.Command))
}

func normalizeLoadedManagedCronJob(job ManagedCronJob) ManagedCronJob {
	job.Name = strings.TrimSpace(job.Name)
	job.Schedule = strings.Join(strings.Fields(job.Schedule), " ")
	job.Command = strings.TrimSpace(job.Command)
	job.Path = managedCronRuntimePath(job.EntryID)
	job.Source = "managed"
	return job
}

func parseManagedCronMetaLine(line string) (managedCronMeta, bool) {
	trimmed := strings.TrimSpace(line)
	if !strings.HasPrefix(trimmed, ManagedCronMarkerPrefix) {
		return managedCronMeta{}, false
	}
	var meta managedCronMeta
	if err := json.Unmarshal([]byte(strings.TrimPrefix(trimmed, ManagedCronMarkerPrefix)), &meta); err != nil {
		return managedCronMeta{}, false
	}
	if strings.TrimSpace(meta.ID) == "" || strings.TrimSpace(meta.NameB64) == "" {
		return managedCronMeta{}, false
	}
	return meta, true
}

func parseManagedCronJob(meta managedCronMeta, line string) (*ManagedCronJob, bool) {
	decodedName, err := decodeManagedCronName(meta.NameB64)
	if err != nil {
		return nil, false
	}
	enabled := true
	trimmed := strings.TrimSpace(line)
	if strings.HasPrefix(trimmed, "#") {
		enabled = false
		trimmed = strings.TrimSpace(strings.TrimPrefix(trimmed, "#"))
	}
	schedule, command, err := SplitCronSpec(trimmed)
	if err != nil {
		return nil, false
	}
	job := cloneManagedCronJobPtr(ManagedCronJob{
		EntryID:  meta.ID,
		Name:     decodedName,
		Schedule: schedule,
		Command:  command,
		Enabled:  enabled,
		Source:   "managed",
	})
	return job, true
}

func renderManagedCronBlock(job ManagedCronJob) []string {
	metaRaw, err := json.Marshal(managedCronMeta{ID: job.EntryID, NameB64: encodeManagedCronName(job.Name)})
	if err != nil {
		metaRaw = []byte(`{"id":"` + job.EntryID + `","name_b64":""}`)
	}
	line := fmt.Sprintf("%s %s %s", job.Schedule, job.Command, "")
	line = strings.TrimSpace(line)
	if !job.Enabled {
		line = "# " + line
	}
	return []string{ManagedCronMarkerPrefix + string(metaRaw), line}
}

func encodeManagedCronName(name string) string {
	return base64.StdEncoding.EncodeToString([]byte(name))
}

func decodeManagedCronName(value string) (string, error) {
	raw, err := base64.StdEncoding.DecodeString(value)
	if err != nil {
		return "", err
	}
	return string(raw), nil
}

func shellQuote(value string) string {
	return "'" + strings.ReplaceAll(value, "'", "'\"'\"'") + "'"
}

func cloneManagedCronJob(job ManagedCronJob) ManagedCronJob {
	copyJob := job
	copyJob.Path = managedCronRuntimePath(copyJob.EntryID)
	copyJob.Source = "managed"
	return copyJob
}

func cloneManagedCronJobPtr(job ManagedCronJob) *ManagedCronJob {
	copyJob := cloneManagedCronJob(job)
	return &copyJob
}

func managedCronRuntimePath(entryID string) string {
	trimmed := strings.TrimSpace(entryID)
	if trimmed == "" {
		return ""
	}
	return ManagedCronFilePath(trimmed)
}
