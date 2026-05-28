package feeds

import (
	"fmt"
	"sort"
	"strings"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

type CleanupSourcePreview struct {
	SourceID      string `json:"source_id"`
	SourceName    string `json:"source_name"`
	CurrentCount  int    `json:"current_count"`
	DeleteCount   int    `json:"delete_count"`
	RetainedCount int    `json:"retained_count"`
}

type CleanupPreview struct {
	GlobalTotalBefore      int                    `json:"global_total_before"`
	GlobalCap              int                    `json:"global_cap"`
	GlobalDeleteCount      int                    `json:"global_delete_count"`
	PerSourceCap           int                    `json:"per_source_cap"`
	PerSourceAffectedCount int                    `json:"per_source_affected_count"`
	PerSourceDeleteCount   int                    `json:"per_source_delete_count"`
	TotalDeleteCount       int                    `json:"total_delete_count"`
	Sources                []CleanupSourcePreview `json:"sources"`
}

type CleanupExecuteResult struct {
	DeletedCount           int `json:"deleted_count"`
	GlobalTotalAfter       int `json:"global_total_after"`
	PerSourceAffectedCount int `json:"per_source_affected_count"`
	GlobalDeleteCount      int `json:"global_delete_count"`
	PerSourceDeleteCount   int `json:"per_source_delete_count"`
}

type cleanupCandidateRow struct {
	ID         string `db:"id"`
	SourceID   string `db:"source_id"`
	SourceName string `db:"source_name"`
}

type cleanupPlan struct {
	Preview           CleanupPreview
	DeleteIDs         []string
	AffectedSourceIDs map[string]struct{}
}

func PreviewCleanup(app core.App) (CleanupPreview, error) {
	policy := LoadPolicySettings(app)
	plan, err := buildCleanupPlan(app, policy.PerSourceCap, policy.GlobalCap)
	if err != nil {
		return CleanupPreview{}, err
	}
	return plan.Preview, nil
}

func ExecuteCleanup(app core.App) (CleanupExecuteResult, error) {
	policy := LoadPolicySettings(app)
	plan, err := buildCleanupPlan(app, policy.PerSourceCap, policy.GlobalCap)
	if err != nil {
		return CleanupExecuteResult{}, err
	}
	return executeCleanupPlan(app, plan)
}

func executeCleanupPlan(app core.App, plan cleanupPlan) (CleanupExecuteResult, error) {
	for _, id := range plan.DeleteIDs {
		record, err := app.FindRecordById(CollectionItems, id)
		if err != nil {
			return CleanupExecuteResult{}, fmt.Errorf("find cleanup candidate %s: %w", id, err)
		}
		if err := app.Delete(record); err != nil {
			return CleanupExecuteResult{}, fmt.Errorf("delete cleanup candidate %s: %w", id, err)
		}
	}

	for sourceID := range plan.AffectedSourceIDs {
		if err := RefreshSourceItemCount(app, sourceID); err != nil {
			return CleanupExecuteResult{}, fmt.Errorf("refresh source item count for %s: %w", sourceID, err)
		}
	}

	return CleanupExecuteResult{
		DeletedCount:           len(plan.DeleteIDs),
		GlobalTotalAfter:       max(0, plan.Preview.GlobalTotalBefore-len(plan.DeleteIDs)),
		PerSourceAffectedCount: plan.Preview.PerSourceAffectedCount,
		GlobalDeleteCount:      plan.Preview.GlobalDeleteCount,
		PerSourceDeleteCount:   plan.Preview.PerSourceDeleteCount,
	}, nil
}

func buildCleanupPlan(app core.App, perSourceCap, globalCap int) (cleanupPlan, error) {
	if perSourceCap < 0 {
		perSourceCap = 0
	}
	if globalCap < 0 {
		globalCap = 0
	}

	rows, err := loadCleanupCandidates(app)
	if err != nil {
		return cleanupPlan{}, err
	}

	currentCounts := make(map[string]int)
	sourceNames := make(map[string]string)
	for _, row := range rows {
		currentCounts[row.SourceID]++
		if sourceNames[row.SourceID] == "" {
			sourceNames[row.SourceID] = strings.TrimSpace(row.SourceName)
		}
	}

	retained := make([]cleanupCandidateRow, 0, len(rows))
	retainedPerSource := make(map[string]int)
	perSourceDeleted := make([]cleanupCandidateRow, 0)
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

	globalDeleted := make([]cleanupCandidateRow, 0)
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

	sources := make([]CleanupSourcePreview, 0, len(perSourceDeleteCounts))
	for sourceID, deleteCount := range perSourceDeleteCounts {
		retainedCount := currentCounts[sourceID] - deleteCount
		if retainedCount < 0 {
			retainedCount = 0
		}
		sources = append(sources, CleanupSourcePreview{
			SourceID:      sourceID,
			SourceName:    sourceNames[sourceID],
			CurrentCount:  currentCounts[sourceID],
			DeleteCount:   deleteCount,
			RetainedCount: retainedCount,
		})
	}
	sort.Slice(sources, func(i, j int) bool {
		if sources[i].DeleteCount != sources[j].DeleteCount {
			return sources[i].DeleteCount > sources[j].DeleteCount
		}
		if sources[i].SourceName != sources[j].SourceName {
			return sources[i].SourceName < sources[j].SourceName
		}
		return sources[i].SourceID < sources[j].SourceID
	})

	preview := CleanupPreview{
		GlobalTotalBefore:      len(rows),
		GlobalCap:              globalCap,
		GlobalDeleteCount:      len(globalDeleted),
		PerSourceCap:           perSourceCap,
		PerSourceAffectedCount: len(sources),
		PerSourceDeleteCount:   len(perSourceDeleted),
		TotalDeleteCount:       len(deleteIDs),
		Sources:                sources,
	}

	return cleanupPlan{
		Preview:           preview,
		DeleteIDs:         deleteIDs,
		AffectedSourceIDs: affectedSourceIDs,
	}, nil
}

func loadCleanupCandidates(app core.App) ([]cleanupCandidateRow, error) {
	rows := make([]cleanupCandidateRow, 0)
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
		return nil, fmt.Errorf("load cleanup candidates: %w", err)
	}
	return rows, nil
}