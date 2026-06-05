package service

import "testing"

func TestResolveAccessEndpointsFromTemplateExposures(t *testing.T) {
	spec := NormalizedInstallSpec{
		RenderedCompose: "services:\n  odoo:\n    image: odoo:18.0\n    ports:\n      - 9010:8069\n",
		Metadata: map[string]any{
			"template_context": map[string]any{
				"exposures": []map[string]any{{
					"label":    "Web",
					"service":  "odoo",
					"port":     8069,
					"protocol": "http",
					"default":  true,
				}},
			},
		},
	}

	endpoints := resolveAccessEndpoints(spec)
	if len(endpoints) != 1 {
		t.Fatalf("expected 1 endpoint, got %d: %v", len(endpoints), endpoints)
	}
	if endpoints[0]["serverPort"] != 9010 || endpoints[0]["port"] != 8069 || endpoints[0]["service"] != "odoo" {
		t.Fatalf("unexpected endpoint: %v", endpoints[0])
	}
}

func TestResolveAccessEndpointsInternalOnly(t *testing.T) {
	spec := NormalizedInstallSpec{
		RenderedCompose: "services:\n  web:\n    image: nginx\n",
		ExposureIntent:  &ExposureIntent{ExposureType: "internal_only"},
		Metadata: map[string]any{
			"template_context": map[string]any{
				"exposures": []map[string]any{{
					"label": "Web", "service": "web", "port": 80, "protocol": "http", "default": true,
				}},
			},
		},
	}

	endpoints := resolveAccessEndpoints(spec)
	if endpoints == nil || len(endpoints) != 0 {
		t.Fatalf("expected empty endpoint list for internal-only, got %#v", endpoints)
	}
}
