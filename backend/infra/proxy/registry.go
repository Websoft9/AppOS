package proxy

import (
	"errors"
	"fmt"
	"regexp"
	"sort"
	"strings"
)

var (
	ErrDirectUseDenied = errors.New("proxy consumer direct use denied")
	ErrUnknownConsumer = errors.New("unknown proxy consumer")

	consumerKeyPattern = regexp.MustCompile(`^[a-z0-9]+(?:[._][a-z0-9]+)+$`)
)

type Scope string

const (
	ScopeModule Scope = "module"
	ScopeAction Scope = "action"
)

type Adapter string

const (
	AdapterHTTPClient Adapter = "http_client"
	AdapterEnv        Adapter = "env"
	AdapterDialer     Adapter = "dialer"
)

type TrafficClass string

const (
	TrafficClassPublicEgress   TrafficClass = "public_egress"
	TrafficClassControlPlane   TrafficClass = "control_plane"
	TrafficClassLocalOrPrivate TrafficClass = "local_or_private"
)

type Support string

const (
	SupportProxyCapable Support = "proxy_capable"
	SupportBypassOnly   Support = "bypass_only"
)

type Location string

const (
	LocationLocal  Location = "local"
	LocationRemote Location = "remote"
)

type Mode string

const (
	ModeDisabled Mode = "disabled"
	ModeAlways   Mode = "always"
)

// Definition declares one known proxy-related network surface.
//
// Definitions are code-owned. Settings may only enroll declared consumers.
// A bypass-only definition exists to make non-proxy control paths explicit and
// to prevent accidental future enrollment.
type Definition struct {
	Key         string
	Title       string
	Description string
	Location    Location
	Scope       Scope
	ModuleKey   string

	// AllowDirectUse controls whether runtime callers may resolve this consumer
	// as a concrete outbound surface. Module-level definitions normally keep
	// this false and act as policy anchors, while action-level definitions set
	// it true to prevent hidden catch-all consumption through *.global keys.
	AllowDirectUse bool

	Adapter      Adapter
	TrafficClass TrafficClass
	Support      Support

	// DefaultMode is the platform-recommended enrollment seed. It is not the
	// final runtime truth once settings enrollment exists.
	DefaultMode Mode
	Tags        []string
}

func (d Definition) Enrollable() bool {
	return d.Support == SupportProxyCapable
}

func (d Definition) SupportsMode(mode Mode) bool {
	switch mode {
	case ModeDisabled:
		return true
	case ModeAlways:
		return d.Support == SupportProxyCapable
	default:
		return false
	}
}

func (d Definition) AllowedModes() []Mode {
	modes := []Mode{ModeDisabled}
	if d.Support == SupportProxyCapable {
		modes = append(modes, ModeAlways)
	}
	return modes
}

func (d Definition) DirectUseAllowed() bool {
	return d.AllowDirectUse
}

type Registry struct {
	items map[string]Definition
	order []string
}

func NewRegistry(definitions ...Definition) (*Registry, error) {
	if len(definitions) == 0 {
		return nil, errors.New("at least one proxy consumer definition is required")
	}

	items := make(map[string]Definition, len(definitions))
	order := make([]string, 0, len(definitions))
	for _, definition := range definitions {
		normalized, err := normalizeDefinition(definition)
		if err != nil {
			return nil, err
		}
		if _, exists := items[normalized.Key]; exists {
			return nil, fmt.Errorf("duplicate proxy consumer key %q", normalized.Key)
		}
		items[normalized.Key] = normalized
		order = append(order, normalized.Key)
	}

	for _, key := range order {
		definition := items[key]
		if definition.Scope != ScopeAction {
			continue
		}
		moduleDef, ok := items[definition.ModuleKey]
		if !ok {
			return nil, fmt.Errorf("proxy consumer %q references unknown module key %q", definition.Key, definition.ModuleKey)
		}
		if moduleDef.Scope != ScopeModule {
			return nil, fmt.Errorf("proxy consumer %q references non-module key %q", definition.Key, definition.ModuleKey)
		}
	}

	return &Registry{items: items, order: order}, nil
}

func MustNewRegistry(definitions ...Definition) *Registry {
	registry, err := NewRegistry(definitions...)
	if err != nil {
		panic(err)
	}
	return registry
}

func (r *Registry) List() []Definition {
	if r == nil || len(r.order) == 0 {
		return nil
	}
	result := make([]Definition, 0, len(r.order))
	for _, key := range r.order {
		result = append(result, r.items[key])
	}
	return result
}

func (r *Registry) Enrollable() []Definition {
	if r == nil {
		return nil
	}
	result := make([]Definition, 0, len(r.order))
	for _, key := range r.order {
		definition := r.items[key]
		if definition.Enrollable() {
			result = append(result, definition)
		}
	}
	return result
}

func (r *Registry) DirectUse() []Definition {
	if r == nil {
		return nil
	}
	result := make([]Definition, 0, len(r.order))
	for _, key := range r.order {
		definition := r.items[key]
		if definition.DirectUseAllowed() {
			result = append(result, definition)
		}
	}
	return result
}

func (r *Registry) Get(key string) (Definition, bool) {
	if r == nil {
		return Definition{}, false
	}
	definition, ok := r.items[strings.TrimSpace(key)]
	return definition, ok
}

func (r *Registry) Require(key string) (Definition, error) {
	definition, ok := r.Get(key)
	if !ok {
		return Definition{}, fmt.Errorf("%w: %s", ErrUnknownConsumer, strings.TrimSpace(key))
	}
	return definition, nil
}

func (r *Registry) RequireDirectUse(key string) (Definition, error) {
	definition, err := r.Require(key)
	if err != nil {
		return Definition{}, err
	}
	if !definition.DirectUseAllowed() {
		return Definition{}, fmt.Errorf("%w: %s", ErrDirectUseDenied, definition.Key)
	}
	return definition, nil
}

func (r *Registry) Keys() []string {
	if r == nil {
		return nil
	}
	return append([]string(nil), r.order...)
}

func normalizeDefinition(definition Definition) (Definition, error) {
	definition.Key = strings.TrimSpace(definition.Key)
	definition.Title = strings.TrimSpace(definition.Title)
	definition.Description = strings.TrimSpace(definition.Description)
	definition.ModuleKey = strings.TrimSpace(definition.ModuleKey)
	definition.Tags = normalizeTags(definition.Tags)

	if definition.Key == "" {
		return Definition{}, errors.New("proxy consumer key is required")
	}
	if !consumerKeyPattern.MatchString(definition.Key) {
		return Definition{}, fmt.Errorf("proxy consumer key %q is invalid", definition.Key)
	}
	if definition.Title == "" {
		return Definition{}, fmt.Errorf("proxy consumer %q requires a title", definition.Key)
	}
	if !isValidScope(definition.Scope) {
		return Definition{}, fmt.Errorf("proxy consumer %q has invalid scope %q", definition.Key, definition.Scope)
	}
	if !isValidLocation(definition.Location) {
		return Definition{}, fmt.Errorf("proxy consumer %q has invalid location %q", definition.Key, definition.Location)
	}
	if !isValidAdapter(definition.Adapter) {
		return Definition{}, fmt.Errorf("proxy consumer %q has invalid adapter %q", definition.Key, definition.Adapter)
	}
	if !isValidTrafficClass(definition.TrafficClass) {
		return Definition{}, fmt.Errorf("proxy consumer %q has invalid traffic class %q", definition.Key, definition.TrafficClass)
	}
	if !isValidSupport(definition.Support) {
		return Definition{}, fmt.Errorf("proxy consumer %q has invalid support %q", definition.Key, definition.Support)
	}
	if !isValidMode(definition.DefaultMode) {
		return Definition{}, fmt.Errorf("proxy consumer %q has invalid default mode %q", definition.Key, definition.DefaultMode)
	}

	if definition.Scope == ScopeModule {
		if !strings.HasSuffix(definition.Key, ".global") {
			return Definition{}, fmt.Errorf("module-level proxy consumer %q must end with .global", definition.Key)
		}
		if definition.ModuleKey != "" {
			return Definition{}, fmt.Errorf("module-level proxy consumer %q must not set module key", definition.Key)
		}
	} else {
		if strings.HasSuffix(definition.Key, ".global") {
			return Definition{}, fmt.Errorf("action-level proxy consumer %q must not end with .global", definition.Key)
		}
		if definition.ModuleKey == "" {
			return Definition{}, fmt.Errorf("action-level proxy consumer %q requires a module key", definition.Key)
		}
		if !consumerKeyPattern.MatchString(definition.ModuleKey) || !strings.HasSuffix(definition.ModuleKey, ".global") {
			return Definition{}, fmt.Errorf("action-level proxy consumer %q has invalid module key %q", definition.Key, definition.ModuleKey)
		}
		if family(definition.Key) != family(definition.ModuleKey) {
			return Definition{}, fmt.Errorf("action-level proxy consumer %q must share family with module key %q", definition.Key, definition.ModuleKey)
		}
	}

	if !definition.SupportsMode(definition.DefaultMode) {
		return Definition{}, fmt.Errorf("proxy consumer %q does not support default mode %q", definition.Key, definition.DefaultMode)
	}

	return definition, nil
}

func normalizeTags(tags []string) []string {
	if len(tags) == 0 {
		return nil
	}
	seen := make(map[string]struct{}, len(tags))
	result := make([]string, 0, len(tags))
	for _, tag := range tags {
		tag = strings.TrimSpace(tag)
		if tag == "" {
			continue
		}
		if _, ok := seen[tag]; ok {
			continue
		}
		seen[tag] = struct{}{}
		result = append(result, tag)
	}
	sort.Strings(result)
	return result
}

func family(key string) string {
	if idx := strings.IndexByte(key, '.'); idx > 0 {
		return key[:idx]
	}
	return key
}

func isValidScope(scope Scope) bool {
	return scope == ScopeModule || scope == ScopeAction
}

func isValidLocation(location Location) bool {
	return location == LocationLocal || location == LocationRemote
}

func isValidAdapter(adapter Adapter) bool {
	return adapter == AdapterHTTPClient || adapter == AdapterEnv || adapter == AdapterDialer
}

func isValidTrafficClass(class TrafficClass) bool {
	return class == TrafficClassPublicEgress || class == TrafficClassControlPlane || class == TrafficClassLocalOrPrivate
}

func isValidSupport(support Support) bool {
	return support == SupportProxyCapable || support == SupportBypassOnly
}

func isValidMode(mode Mode) bool {
	return mode == ModeDisabled || mode == ModeAlways
}
