package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/tools/types"
)

func init() {
	m.Register(func(app core.App) error {
		col, err := app.FindCollectionByNameOrId("secrets")
		if err != nil {
			return err
		}

		ownerOrSuper := "created_by = @request.auth.id || @request.auth.collectionName = '_superusers'"
		superOnly := "@request.auth.collectionName = '_superusers'"
		anyAuth := "@request.auth.id != ''"

		col.ListRule = &ownerOrSuper
		col.ViewRule = &ownerOrSuper
		col.CreateRule = &anyAuth
		col.UpdateRule = &ownerOrSuper
		col.DeleteRule = &superOnly

		// Relax legacy Epic 8 field: 'type' is no longer required
		relaxSelectFieldRequired(col, "type")

		ensureTextField(col, "template_id", false, false, 120)
		ensureSelectField(col, "scope", []string{"global", "user_private"}, false)
		ensureSelectField(col, "access_mode", []string{"use_only", "reveal_once", "reveal_allowed"}, false)
		ensureJSONFieldHidden(col, "payload")
		ensureTextField(col, "payload_encrypted", false, true, 0)
		ensureJSONField(col, "payload_meta")
		ensureAutodateField(col, "created", true, false)
		ensureAutodateField(col, "updated", true, true)
		ensureSelectField(col, "status", []string{"active", "revoked"}, false)
		ensureNumberField(col, "version")
		ensureDateField(col, "last_used_at")
		ensureTextField(col, "last_used_by", false, false, 200)
		ensureTextField(col, "created_by", false, false, 100)

		col.AddIndex("idx_secrets_created_by", false, "created_by", "")
		col.AddIndex("idx_secrets_template_id", false, "template_id", "")

		return app.Save(col)
	}, func(app core.App) error {
		col, err := app.FindCollectionByNameOrId("secrets")
		if err != nil {
			return nil
		}

		dropField(col, "payload")
		dropField(col, "template_id")
		dropField(col, "scope")
		dropField(col, "access_mode")
		dropField(col, "payload_encrypted")
		dropField(col, "payload_meta")
		dropField(col, "status")
		dropField(col, "version")
		dropField(col, "last_used_at")
		dropField(col, "last_used_by")
		dropField(col, "created_by")

		col.ListRule = nil
		col.ViewRule = nil
		col.CreateRule = nil
		col.UpdateRule = nil
		col.DeleteRule = nil

		return app.Save(col)
	})
}

func ensureTextField(col *core.Collection, name string, required, hidden bool, max int) {
	if f := col.Fields.GetByName(name); f != nil {
		tf, ok := f.(*core.TextField)
		if ok {
			tf.Required = required
			tf.Hidden = hidden
			if max > 0 {
				tf.Max = max
			}
		}
		return
	}
	f := &core.TextField{Name: name, Required: required, Hidden: hidden}
	if max > 0 {
		f.Max = max
	}
	col.Fields.Add(f)
}

func ensureSelectField(col *core.Collection, name string, values []string, required bool) {
	if f := col.Fields.GetByName(name); f != nil {
		sf, ok := f.(*core.SelectField)
		if ok {
			sf.Required = required
			sf.MaxSelect = 1
			sf.Values = values
		}
		return
	}
	col.Fields.Add(&core.SelectField{Name: name, Required: required, MaxSelect: 1, Values: values})
}

func ensureJSONField(col *core.Collection, name string) {
	if col.Fields.GetByName(name) != nil {
		return
	}
	col.Fields.Add(&core.JSONField{Name: name})
}

func ensureJSONFieldHidden(col *core.Collection, name string) {
	if f := col.Fields.GetByName(name); f != nil {
		jf, ok := f.(*core.JSONField)
		if ok {
			jf.Hidden = true
		}
		return
	}
	col.Fields.Add(&core.JSONField{Name: name, Hidden: true})
}

func ensureNumberField(col *core.Collection, name string) {
	if f := col.Fields.GetByName(name); f != nil {
		nf, ok := f.(*core.NumberField)
		if ok {
			nf.OnlyInt = true
			nf.Min = types.Pointer(1.0)
		}
		return
	}
	col.Fields.Add(&core.NumberField{Name: name, OnlyInt: true, Min: types.Pointer(1.0)})
}

func ensureDateField(col *core.Collection, name string) {
	if col.Fields.GetByName(name) != nil {
		return
	}
	col.Fields.Add(&core.DateField{Name: name})
}

func ensureAutodateField(col *core.Collection, name string, onCreate, onUpdate bool) {
	if f := col.Fields.GetByName(name); f != nil {
		af, ok := f.(*core.AutodateField)
		if ok {
			af.OnCreate = onCreate
			af.OnUpdate = onUpdate
		}
		return
	}
	col.Fields.Add(&core.AutodateField{Name: name, OnCreate: onCreate, OnUpdate: onUpdate})
}

func relaxSelectFieldRequired(col *core.Collection, name string) {
	if f := col.Fields.GetByName(name); f != nil {
		sf, ok := f.(*core.SelectField)
		if ok {
			sf.Required = false
		}
	}
}

func dropField(col *core.Collection, name string) {
	col.Fields.RemoveByName(name)
}
