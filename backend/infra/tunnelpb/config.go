package tunnelpb

import (
	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/config/sysconfig"
	settingscatalog "github.com/websoft9/appos/backend/domain/config/sysconfig/catalog"
	tunnelcore "github.com/websoft9/appos/backend/infra/tunnelcore"
)

const (
	SettingsModule = "tunnel"
	PortRangeKey   = "port_range"
)

func LoadPortRange(app core.App) tunnelcore.PortRange {
	if app == nil {
		return tunnelcore.DefaultPortRange()
	}

	raw, _ := sysconfig.GetGroup(app, SettingsModule, PortRangeKey, settingscatalog.DefaultGroup(SettingsModule, PortRangeKey))
	return tunnelcore.NormalizePortRange(raw)
}
