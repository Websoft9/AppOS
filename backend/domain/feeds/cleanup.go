package feeds

import (
	"fmt"
	"strings"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

type RetentionSweepResult struct {
	DeletedCount           int `json:"deleted_count"`
	GlobalTotalAfter       int `json:"global_total_after"`
	PerSourceAffectedCount int `json:"per_source_affected_count"`
	GlobalDeleteCount      int `json:"global_delete_count"`
	PerSourceDeleteCount   int `json:"per_source_delete_count"`
}

type SourceDeleteResult struct {
	SourceID       string `json:"source_id"`
	RequestedCount int    `json:"requested_count"`
	DeletedCount   int    `json:"deleted_count"`
	RemainingCount int    `json:"remaining_count"`
}

type GlobalDeleteResult struct {
	RequestedCount int `json:"requested_count"`
	DeletedCount   int `json:"deleted_count"`
	RemainingCount int `json:"remaining_count"`
}

type retentionCandidateRow struct {
	ID         string `db:"id"`
	SourceID   string `db:"source_id"`
	SourceName string `db:"source_name"`
}

type retentionPlan struct {
	GlobalTotalBefore      int
	GlobalDeleteCount      int
	PerSourceAffectedCount int
	PerSourceDeleteCount   int
	DeleteIDs              []string
	AffectedSourceIDs      map[string]struct{}
}

func RunRetentionSweep(app core.App) (RetentionSweepResult, error) {
	policy := LoadPolicySettings(app)
	plan, err := buildRetentionPlan(app, policy.PerSourceCap, policy.GlobalCap)
	if err != nil {
		return RetentionSweepResult{}, err
	}
	return executeRetentionPlan(app, plan)
}

func DeleteSourceItems(app core.App, sourceID string, count int) (SourceDeleteResult, error) {
	trimmedSourceID := strings.TrimSpace(sourceID)
	if trimmedSourceID == "" {
		return SourceDeleteResult{}, fmt.Errorf("source id is required")
	}
	if count <= 0 {
		return SourceDeleteResult{}, fmt.Errorf("count must be greater than zero")
	}

	rows, err := loadOldestFeedItems(app, trimmedSourceID, count)
	if err != nil {
		return SourceDeleteResult{}, err
	}
	if err := deleteFeedItemRows(app, rows); err != nil {
		return SourceDeleteResult{}, err
	}
	if err := RefreshSourceItemCount(app, trimmedSourceID); err != nil {
		return SourceDeleteResult{}, fmt.Errorf("refresh source item count for %s: %w", trimmedSourceID, err)
	}

	remainingCount, err := countFeedItems(app, trimmedSourceID)
	if err != nil {
		return SourceDeleteResult{}, err
	}

	return SourceDeleteResult{
		SourceID:       trimmedSourceID,
		RequestedCount: count,
		DeletedCount:   len(rows),
		RemainingCount: remainingCount,
	}, nil
}

func DeleteGlobalItems(app core.App, count int) (GlobalDeleteResult, error) {
	if count <= 0 {
		return GlobalDeleteResult{}, fmt.Errorf("count must be greater than zero")
	}

	rows, err := loadOldestFeedItems(app, "", count)
	if err != nil {
		return GlobalDeleteResult{}, err
	}
	if err := deleteFeedItemRows(app, rows); err != nil {
		return GlobalDeleteResult{}, err
	}

	affectedSourceIDs := make(map[string]struct{})
	for _, row := range rows {
		if strings.TrimSpace(row.SourceID) != "" {
			affectedSourceIDs[row.SourceID] = struct{}{}
		}
	}
	for sourceID := range affectedSourceIDs {
		if err := RefreshSourceItemCount(app, sourceID); err != nil {
			return GlobalDeleteResult{}, fmt.Errorf("refresh source item count for %s: %w", sourceID, err)
		}
	}

	remainingCount, err := countFeedItems(app, "")
	if err != nil {
		return GlobalDeleteResult{}, err
	}

	return GlobalDeleteResult{
		RequestedCount: count,
		DeletedCount:   len(rows),
		RemainingCount: remainingCount,
	}, nil
}

func executeRetentionPlan(app core.App, plan retentionPlan) (RetentionSweepResult, error) {
	for _, id := range plan.DeleteIDs {
		record, err := app.FindRecordById(CollectionItems, id)
		if err != nil {
			return RetentionSweepResult{}, fmt.Errorf("find retention candidate %s: %w", id, err)
		}
		if err := app.Delete(record); err != nil {
			return RetentionSweepResult{}, fmt.Errorf("delete retention candidate %s: %w", id, err)
		}
	}

	for sourceID := range plan.AffectedSourceIDs {
		if err := RefreshSourceItemCount(app, sourceID); err != nil {
			return RetentionSweepResult{}, fmt.Errorf("refresh source item count for %s: %w", sourceID, err)
		}
	}

	return RetentionSweepResult{
		DeletedCount:           len(plan.DeleteIDs),
		GlobalTotalAfter:       max(0, plan.GlobalTotalBefore-len(plan.DeleteIDs)),
		PerSourceAffectedCount: plan.PerSourceAffectedCount,
		GlobalDeleteCount:      plan.GlobalDeleteCount,
		PerSourceDeleteCount:   plan.PerSourceDeleteCount,
	}, nil
}

func buildRetentionPlan(app core.App, perSourceCap, globalCap int) (retentionPlan, error) {
	if perSourceCap < 0 {
		perSourceCap = 0
	}
	if globalCap < 0 {
		globalCap = 0
	}

	rows, err := loadRetentionCandidates(app)
	if err != nil {
		return retentionPlan{}, err
	}

	retained := make([]retentionCandidateRow, 0, len(rows))
	retainedPerSource := make(map[string]int)
	perSourceDeleted := make([]retentionCandidateRow, 0)
	perSourceDeleteCounts := make(map[string]int)
	affectedSourceIDs := make(map[string]struct{})

	for _, row := range rows {
		if retainedPerSource[row.SourceID] < perSourceCap {
			retainedPerSource[row.SourceID]++
			retained = append(retained, row)
			continue
		}
		perSourceDeleted = append(perSourceDeleted, row)
		perSourceDeleteCounts[row.SourceID]++
		if strings.TrimSpace(row.SourceID) != "" {
			affectedSourceIDs[row.SourceID] = struct{}{}
		}
	}

	globalDeleted := make([]retentionCandidateRow, 0)
	if len(retained) > globalCap {
		globalDeleted = append(globalDeleted, retained[globalCap:]...)
		for _, row := range globalDeleted {
			if strings.TrimSpace(row.SourceID) != "" {
				affectedSourceIDs[row.SourceID] = struct{}{}
			}
		}
	}

	deleteIDs := make([]string, 0, len(perSourceDeleted)+len(globalDeleted))
	for _, row := range perSourceDeleted {
		deleteIDs = append(deleteIDs, row.ID)
	}
	for _, row := range globalDeleted {
		deleteIDs = append(deleteIDs, row.ID)
	}

	affectedSourceCount := len(perSourceDeleteCounts)

	return retentionPlan{
		GlobalTotalBefore:      len(rows),
		GlobalDeleteCount:      len(globalDeleted),
		PerSourceAffectedCount: affectedSourceCount,
		PerSourceDeleteCount:   len(perSourceDeleted),
		DeleteIDs:              deleteIDs,
		AffectedSourceIDs:      affectedSourceIDs,
	}, nil
}

func loadRetentionCandidates(app core.App) ([]retentionCandidateRow, error) {
	rows := make([]retentionCandidateRow, 0)
	err := app.DB().NewQuery(`
		SELECT
			fi.id,
			coalesce(fi.source_id, '') AS source_id,
			coalesce(fs.name, '') AS source_name
		FROM feed_items fi
		LEFT JOIN feed_sources fs ON fs.id = fi.source_id
		WHERE fi.origin_type = {:origin_type}
		ORDER BY coalesce(nullif(fi.published_at, ''), fi.created) DESC, fi.id DESC`,
	).Bind(dbx.Params{"origin_type": OriginTypeFeed}).All(&rows)
	if err != nil {
		return nil, fmt.Errorf("load retention candidates: %w", err)
	}
	return rows, nil
}

func loadOldestFeedItems(app core.App, sourceID string, limit int) ([]retentionCandidateRow, error) {
	trimmedSourceID := strings.TrimSpace(sourceID)
	rows := make([]retentionCandidateRow, 0, limit)
	params := dbx.Params{
		"origin_type": OriginTypeFeed,
		"limit":       limit,
	}
	whereClause := "fi.origin_type = {:origin_type}"
	if trimmedSourceID != "" {
		whereClause += " AND fi.source_id = {:source_id}"
		params["source_id"] = trimmedSourceID
	}

	err := app.DB().NewQuery(`
		SELECT
			fi.id,
			coalesce(fi.source_id, '') AS source_id,
			coalesce(fs.name, '') AS source_name
		FROM feed_items fi
		LEFT JOIN feed_sources fs ON fs.id = fi.source_id
		WHERE ` + whereClause + `
		ORDER BY coalesce(nullif(fi.published_at, ''), fi.created) ASC, fi.id ASC
		LIMIT {:limit}`,
	).Bind(params).All(&rows)
	if err != nil {
		return nil, fmt.Errorf("load oldest feed items: %w", err)
	}

	return rows, nil
}

func deleteFeedItemRows(app core.App, rows []retentionCandidateRow) error {
	for _, row := range rows {
		record, err := app.FindRecordById(CollectionItems, row.ID)
		if err != nil {
			return fmt.Errorf("find feed item %s: %w", row.ID, err)
		}
		if err := app.Delete(record); err != nil {
			return fmt.Errorf("delete feed item %s: %w", row.ID, err)
		}
	}

	return nil
}

func countFeedItems(app core.App, sourceID string) (int, error) {
	trimmedSourceID := strings.TrimSpace(sourceID)
	params := dbx.Params{"origin_type": OriginTypeFeed}
	whereClause := "origin_type = {:origin_type}"
	if trimmedSourceID != "" {
		whereClause += " AND source_id = {:source_id}"
		params["source_id"] = trimmedSourceID
	}

	result := struct {
		Count int `db:"count"`
	}{}
	if err := app.DB().NewQuery(`SELECT COUNT(*) AS count FROM feed_items WHERE ` + whereClause).Bind(params).One(&result); err != nil {
		return 0, fmt.Errorf("count feed items: %w", err)
	}

	return result.Count, nil
}
