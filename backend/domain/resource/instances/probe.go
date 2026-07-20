package instances

import (
	"errors"

	instanceruntime "github.com/websoft9/appos/backend/domain/resource/instances/runtime"
)

type ProbeTarget = instanceruntime.ProbeTarget

func ResolveProbeTarget(item *Instance) (ProbeTarget, error) {
	if item == nil {
		return ProbeTarget{}, errors.New("instance is nil")
	}
	return instanceruntime.ResolveProbeTarget(item.Endpoint(), item.Kind(), item.TemplateID(), func(templateID string) (string, error) {
		template, ok, err := FindTemplate(templateID)
		if err != nil {
			return "", err
		}
		if !ok {
			return "", nil
		}
		return template.DefaultEndpoint, nil
	})
}
