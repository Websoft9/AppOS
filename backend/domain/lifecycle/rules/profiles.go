package rules

import (
	"fmt"
	"strings"

	"github.com/websoft9/appos/backend/domain/lifecycle/model"
)

type Profile struct {
	Key                  string
	MaxParallelNodes     int
	CompensationPolicy   string
	ManualGatePolicy     string
	VerificationPolicy   string
	PublicationSensitive bool
}

var profilesByKey = map[string]Profile{
	string(model.RuleProfileComposeStandard): {
		Key:                string(model.RuleProfileComposeStandard),
		MaxParallelNodes:   1,
		CompensationPolicy: string(model.CompensationPolicyBestEffort),
		VerificationPolicy: "runtime_health",
	},
	string(model.RuleProfileSourceBuild): {
		Key:                string(model.RuleProfileSourceBuild),
		MaxParallelNodes:   2,
		CompensationPolicy: string(model.CompensationPolicyBestEffort),
		VerificationPolicy: "runtime_health",
	},
	string(model.RuleProfileRuntimeControl): {
		Key:                string(model.RuleProfileRuntimeControl),
		MaxParallelNodes:   1,
		CompensationPolicy: string(model.CompensationPolicyBestEffort),
		VerificationPolicy: "runtime_health",
	},
	string(model.RuleProfileChangeStandard): {
		Key:                string(model.RuleProfileChangeStandard),
		MaxParallelNodes:   1,
		CompensationPolicy: string(model.CompensationPolicyStrict),
		VerificationPolicy: "runtime_health",
	},
	string(model.RuleProfileExposureSensitive): {
		Key:                  string(model.RuleProfileExposureSensitive),
		MaxParallelNodes:     1,
		CompensationPolicy:   string(model.CompensationPolicyStrict),
		VerificationPolicy:   "publication_check",
		PublicationSensitive: true,
	},
	string(model.RuleProfileRecoveryStrict): {
		Key:                string(model.RuleProfileRecoveryStrict),
		MaxParallelNodes:   1,
		CompensationPolicy: string(model.CompensationPolicyManualGate),
		ManualGatePolicy:   "operator_required",
		VerificationPolicy: "runtime_health",
	},
	string(model.RuleProfileMaintenanceStandard): {
		Key:                string(model.RuleProfileMaintenanceStandard),
		MaxParallelNodes:   1,
		CompensationPolicy: string(model.CompensationPolicyBestEffort),
		VerificationPolicy: "runtime_health",
	},
	string(model.RuleProfileRetireStandard): {
		Key:                string(model.RuleProfileRetireStandard),
		MaxParallelNodes:   1,
		CompensationPolicy: string(model.CompensationPolicyStrict),
		VerificationPolicy: "stopped_state",
	},
}

func Resolve(operationType string, executionMode string, requested string) (Profile, error) {
	if requestedProfile, ok := Lookup(requested); ok {
		return requestedProfile, nil
	}

	switch normalize(operationType) {
	case string(model.OperationTypeInstall):
		if normalize(executionMode) == string(model.ExecutionModeBuild) {
			return profilesByKey[string(model.RuleProfileSourceBuild)], nil
		}
		return profilesByKey[string(model.RuleProfileComposeStandard)], nil
	case string(model.OperationTypeStart), string(model.OperationTypeRestart):
		return profilesByKey[string(model.RuleProfileRuntimeControl)], nil
	case string(model.OperationTypeUpgrade), string(model.OperationTypeRedeploy), string(model.OperationTypeReconfigure):
		return profilesByKey[string(model.RuleProfileChangeStandard)], nil
	case string(model.OperationTypePublish), string(model.OperationTypeUnpublish):
		return profilesByKey[string(model.RuleProfileExposureSensitive)], nil
	case string(model.OperationTypeRecover), string(model.OperationTypeRollback), string(model.OperationTypeRestore):
		return profilesByKey[string(model.RuleProfileRecoveryStrict)], nil
	case string(model.OperationTypeMaintain), string(model.OperationTypeBackup):
		return profilesByKey[string(model.RuleProfileMaintenanceStandard)], nil
	case string(model.OperationTypeStop), string(model.OperationTypeUninstall):
		return profilesByKey[string(model.RuleProfileRetireStandard)], nil
	default:
		return Profile{}, fmt.Errorf("rule profile not found for operation_type %q with execution_mode %q", normalize(operationType), normalize(executionMode))
	}
}

func Lookup(key string) (Profile, bool) {
	profile, ok := profilesByKey[normalize(key)]
	return profile, ok
}

func normalize(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}
