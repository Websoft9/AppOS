package schema

import "github.com/pocketbase/pocketbase/core"

func EnsureTopicCommentsCollection(app core.App) error {
	topicsCol, err := app.FindCollectionByNameOrId("topics")
	if err != nil {
		return err
	}
	col, err := app.FindCollectionByNameOrId("topic_comments")
	if err != nil {
		col = core.NewBaseCollection("topic_comments")
	}
	authRule := "@request.auth.id != ''"
	ownerRule := "created_by = @request.auth.id"
	col.ListRule = &authRule
	col.ViewRule = &authRule
	col.CreateRule = &authRule
	col.UpdateRule = &ownerRule
	col.DeleteRule = &ownerRule
	addFieldIfMissing(col, &core.RelationField{Name: "topic_id", CollectionId: topicsCol.Id, Required: true, CascadeDelete: true, MaxSelect: 1})
	addFieldIfMissing(col, &core.TextField{Name: "body", Required: true})
	addFieldIfMissing(col, &core.TextField{Name: "created_by", Required: true, Max: 100})
	addFieldIfMissing(col, &core.AutodateField{Name: "created", OnCreate: true})
	addFieldIfMissing(col, &core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true})
	return app.Save(col)
}
