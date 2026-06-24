package worker

import (
	"context"
	"errors"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/websoft9/appos/backend/domain/config/sysconfig"
)

type fakeDeploymentImageClient struct {
	inspectErr map[string]error
	pullErr    map[string]error
	pullErrSeq map[string][]error
	pulls      []string
	tags       [][2]string
	blockPull  bool
	available  map[string]bool
	disableAutoAvailableOnPull bool
	disableAutoAvailableOnTag  bool
}

func (f *fakeDeploymentImageClient) ImageInspect(_ context.Context, id string) (string, error) {
	if f.available != nil && f.available[id] {
		return "[]", nil
	}
	if err, ok := f.inspectErr[id]; ok {
		return "", err
	}
	return "[]", nil
}

func (f *fakeDeploymentImageClient) ImagePull(ctx context.Context, name string) (string, error) {
	f.pulls = append(f.pulls, name)
	if f.blockPull {
		<-ctx.Done()
		return "", ctx.Err()
	}
	if seq, ok := f.pullErrSeq[name]; ok && len(seq) > 0 {
		err := seq[0]
		f.pullErrSeq[name] = seq[1:]
		if err != nil {
			return "", err
		}
		return "ok", nil
	}
	if err, ok := f.pullErr[name]; ok {
		return "", err
	}
	if !f.disableAutoAvailableOnPull {
		if f.available == nil {
			f.available = map[string]bool{}
		}
		f.available[name] = true
		delete(f.inspectErr, name)
	}
	return "ok", nil
}

func (f *fakeDeploymentImageClient) ImageTag(_ context.Context, sourceRef string, targetRef string) (string, error) {
	f.tags = append(f.tags, [2]string{sourceRef, targetRef})
	if !f.disableAutoAvailableOnTag {
		if f.available == nil {
			f.available = map[string]bool{}
		}
		f.available[targetRef] = true
		delete(f.inspectErr, targetRef)
	}
	return "ok", nil
}

func TestBuildMirroredImageReference(t *testing.T) {
	tests := []struct {
		name   string
		image  string
		mirror string
		want   string
		ok     bool
	}{
		{name: "docker hub implicit library", image: "nginx:alpine", mirror: "mirror.example.com", want: "mirror.example.com/library/nginx:alpine", ok: true},
		{name: "docker hub namespaced", image: "bitnami/wordpress:6", mirror: "mirror.example.com", want: "mirror.example.com/bitnami/wordpress:6", ok: true},
		{name: "explicit registry", image: "ghcr.io/org/app:1.0", mirror: "mirror.example.com", want: "mirror.example.com/ghcr.io/org/app:1.0", ok: true},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, ok := buildMirroredImageReference(tc.image, tc.mirror)
			if ok != tc.ok || got != tc.want {
				t.Fatalf("buildMirroredImageReference(%q, %q) = (%q, %v), want (%q, %v)", tc.image, tc.mirror, got, ok, tc.want, tc.ok)
			}
		})
	}
}

func TestPrepareDeploymentImagesFallsBackToMirrorAndTagsOriginal(t *testing.T) {
	app := newWorkerTestApp(t)
	if err := sysconfig.SetGroup(app, "docker", "mirror", map[string]any{
		"mirrors":                 []any{"mirror.example.com"},
		"allowInsecureRegistries": false,
	}); err != nil {
		t.Fatal(err)
	}

	client := &fakeDeploymentImageClient{
		inspectErr: map[string]error{"nginx:alpine": errors.New("missing")},
		pullErr:    map[string]error{"nginx:alpine": errors.New("network unreachable")},
	}

	err := prepareDeploymentImages(context.Background(), app, client, "services:\n  web:\n    image: nginx:alpine\n", func(string) {})
	if err != nil {
		t.Fatal(err)
	}

	if !reflect.DeepEqual(client.pulls, []string{"nginx:alpine", "mirror.example.com/library/nginx:alpine"}) {
		t.Fatalf("unexpected pull order: %#v", client.pulls)
	}
	if !reflect.DeepEqual(client.tags, [][2]string{{"mirror.example.com/library/nginx:alpine", "nginx:alpine"}}) {
		t.Fatalf("unexpected tag operations: %#v", client.tags)
	}
}

func TestPrepareDeploymentImagesTimesOutPull(t *testing.T) {
	app := newWorkerTestApp(t)
	if err := sysconfig.SetGroup(app, "docker", "mirror", map[string]any{
		"mirrors":                 []any{},
		"allowInsecureRegistries": false,
	}); err != nil {
		t.Fatal(err)
	}
	client := &fakeDeploymentImageClient{
		inspectErr: map[string]error{"nginx:alpine": errors.New("missing")},
		blockPull:  true,
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Millisecond)
	defer cancel()

	err := prepareDeploymentImages(ctx, app, client, "services:\n  web:\n    image: nginx:alpine\n", func(string) {})
	if err == nil {
		t.Fatal("expected timeout error")
	}
	if got := err.Error(); !strings.Contains(got, "timed out pulling image nginx:alpine") {
		t.Fatalf("expected timeout error, got %q", got)
	}
}

func TestPrepareDeploymentImagesRetriesEachMirrorBeforeMovingOn(t *testing.T) {
	app := newWorkerTestApp(t)
	if err := sysconfig.SetGroup(app, "docker", "mirror", map[string]any{
		"mirrors":                 []any{"mirror-a.example.com", "mirror-b.example.com"},
		"allowInsecureRegistries": false,
	}); err != nil {
		t.Fatal(err)
	}

	client := &fakeDeploymentImageClient{
		inspectErr: map[string]error{"nginx:alpine": errors.New("missing")},
		pullErr:    map[string]error{"nginx:alpine": errors.New("network unreachable")},
		pullErrSeq: map[string][]error{
			"mirror-a.example.com/library/nginx:alpine": {errors.New("attempt1"), errors.New("attempt2"), errors.New("attempt3")},
			"mirror-b.example.com/library/nginx:alpine": {errors.New("attempt1"), errors.New("attempt2"), nil},
		},
	}

	err := prepareDeploymentImages(context.Background(), app, client, "services:\n  web:\n    image: nginx:alpine\n", func(string) {})
	if err != nil {
		t.Fatal(err)
	}

	wantPulls := []string{
		"nginx:alpine",
		"mirror-a.example.com/library/nginx:alpine",
		"mirror-a.example.com/library/nginx:alpine",
		"mirror-a.example.com/library/nginx:alpine",
		"mirror-b.example.com/library/nginx:alpine",
		"mirror-b.example.com/library/nginx:alpine",
		"mirror-b.example.com/library/nginx:alpine",
	}
	if !reflect.DeepEqual(client.pulls, wantPulls) {
		t.Fatalf("unexpected pull order: %#v", client.pulls)
	}
	if !reflect.DeepEqual(client.tags, [][2]string{{"mirror-b.example.com/library/nginx:alpine", "nginx:alpine"}}) {
		t.Fatalf("unexpected tag operations: %#v", client.tags)
	}
}

func TestPrepareDeploymentImagesFailsWhenPulledImageCannotBeVerifiedLocally(t *testing.T) {
	app := newWorkerTestApp(t)
	if err := sysconfig.SetGroup(app, "docker", "mirror", map[string]any{
		"mirrors":                 []any{},
		"allowInsecureRegistries": false,
	}); err != nil {
		t.Fatal(err)
	}

	client := &fakeDeploymentImageClient{
		inspectErr:                 map[string]error{"nginx:alpine": errors.New("missing after pull")},
		disableAutoAvailableOnPull: true,
	}

	err := prepareDeploymentImages(context.Background(), app, client, "services:\n  web:\n    image: nginx:alpine\n", func(string) {})
	if err == nil {
		t.Fatal("expected local verification failure")
	}
	if got := err.Error(); !strings.Contains(got, "image is still unavailable locally") {
		t.Fatalf("expected local verification error, got %q", got)
	}
}
