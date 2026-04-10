package service

import (
	"strings"
	"testing"

	"github.com/websoft9/appos/backend/domain/deploy"
	"github.com/websoft9/appos/backend/domain/lifecycle/model"
)

func TestBuildManualComposeInstallResolutionRequestSetsCandidateKind(t *testing.T) {
	request := deploy.ManualComposeRequest{
		ServerID:    "local",
		ProjectName: "Demo App",
		Compose:     "services:\n  web:\n    image: nginx:alpine\n",
	}
	resolution := BuildManualComposeInstallResolutionRequest(request, InstallIngressOptions{
		Metadata: map[string]any{"channel": "stable"},
	})

	if resolution.Source != deploy.SourceManualOps || resolution.Adapter != deploy.AdapterManualCompose {
		t.Fatalf("expected manual source/adapter, got %q/%q", resolution.Source, resolution.Adapter)
	}
	if resolution.Metadata["candidate_kind"] != string(InstallCandidateKindManualCompose) {
		t.Fatalf("expected candidate_kind %q, got %v", InstallCandidateKindManualCompose, resolution.Metadata["candidate_kind"])
	}
	originContext, ok := resolution.Metadata["origin_context"].(map[string]any)
	if !ok {
		t.Fatalf("expected origin_context map, got %T", resolution.Metadata["origin_context"])
	}
	if originContext["source"] != deploy.SourceManualOps || originContext["adapter"] != deploy.AdapterManualCompose {
		t.Fatalf("expected manual origin_context, got %v", originContext)
	}
	if resolution.Metadata["channel"] != "stable" {
		t.Fatalf("expected existing metadata to survive, got %v", resolution.Metadata)
	}
}

func TestBuildManualComposeInstallResolutionRequestHonorsExplicitCandidateKind(t *testing.T) {
	request := deploy.ManualComposeRequest{
		ServerID:    "local",
		ProjectName: "Demo App",
		Compose:     "services:\n  web:\n    image: nginx:alpine\n",
	}
	resolution := BuildManualComposeInstallResolutionRequest(request, InstallIngressOptions{
		Metadata: map[string]any{
			"candidate_kind": string(InstallCandidateKindStorePrefill),
			"prefill_context": map[string]any{
				"mode":    "target",
				"app_key": "wordpress",
			},
		},
	})

	if resolution.Metadata["candidate_kind"] != string(InstallCandidateKindStorePrefill) {
		t.Fatalf("expected candidate_kind override %q, got %v", InstallCandidateKindStorePrefill, resolution.Metadata["candidate_kind"])
	}
	prefillContext, ok := resolution.Metadata["prefill_context"].(map[string]any)
	if !ok {
		t.Fatalf("expected prefill_context map, got %T", resolution.Metadata["prefill_context"])
	}
	if prefillContext["mode"] != "target" || prefillContext["app_key"] != "wordpress" {
		t.Fatalf("expected prefill context to survive, got %v", prefillContext)
	}
	originContext, ok := resolution.Metadata["origin_context"].(map[string]any)
	if !ok {
		t.Fatalf("expected origin_context map, got %T", resolution.Metadata["origin_context"])
	}
	if originContext["source"] != deploy.SourceManualOps || originContext["adapter"] != deploy.AdapterManualCompose {
		t.Fatalf("expected manual origin_context, got %v", originContext)
	}
}

func TestBuildManualComposeInstallResolutionRequestUsesSourceBuildAdapterWhenPresent(t *testing.T) {
	request := deploy.ManualComposeRequest{
		ServerID:    "local",
		ProjectName: "Demo App",
		Compose:     "services:\n  web:\n    image: nginx:alpine\n",
	}
	resolution := BuildManualComposeInstallResolutionRequest(request, InstallIngressOptions{
		SourceBuild: &InstallSourceBuildInput{
			SourceKind:      "uploaded-package",
			SourceRef:       "upload://app.tar.gz",
			WorkspaceRef:    "workspace://operations/demo/source",
			BuilderStrategy: "buildpacks",
			ArtifactPublication: &InstallArtifactPublication{
				Mode:      "local",
				ImageName: "apps/demo",
			},
		},
	})

	if resolution.Adapter != deploy.AdapterSourceBuild {
		t.Fatalf("expected source-build adapter, got %q", resolution.Adapter)
	}
	if resolution.Metadata["candidate_kind"] != string(InstallCandidateKindInstallScript) {
		t.Fatalf("expected candidate_kind %q, got %v", InstallCandidateKindInstallScript, resolution.Metadata["candidate_kind"])
	}
	originContext, ok := resolution.Metadata["origin_context"].(map[string]any)
	if !ok {
		t.Fatalf("expected origin_context map, got %T", resolution.Metadata["origin_context"])
	}
	if originContext["adapter"] != deploy.AdapterSourceBuild {
		t.Fatalf("expected source-build origin adapter, got %v", originContext)
	}
}

func TestBuildGitComposeInstallResolutionRequestSetsCandidateKind(t *testing.T) {
	request := deploy.GitComposeRequest{
		ServerID:      "local",
		RepositoryURL: "https://github.com/example/demo",
		ComposePath:   "docker-compose.yml",
		Ref:           "main",
	}
	resolution := BuildGitComposeInstallResolutionRequest(request, "services:\n  web:\n    image: nginx:alpine\n", "https://raw.githubusercontent.com/example/demo/main/docker-compose.yml", InstallIngressOptions{
		Metadata: map[string]any{"channel": "stable"},
	})

	if resolution.Source != deploy.SourceGitOps || resolution.Adapter != deploy.AdapterGitCompose {
		t.Fatalf("expected git source/adapter, got %q/%q", resolution.Source, resolution.Adapter)
	}
	if resolution.ProjectName != "demo" {
		t.Fatalf("expected derived project name demo, got %q", resolution.ProjectName)
	}
	if resolution.Metadata["candidate_kind"] != string(InstallCandidateKindGitCompose) {
		t.Fatalf("expected candidate_kind %q, got %v", InstallCandidateKindGitCompose, resolution.Metadata["candidate_kind"])
	}
	originContext, ok := resolution.Metadata["origin_context"].(map[string]any)
	if !ok {
		t.Fatalf("expected origin_context map, got %T", resolution.Metadata["origin_context"])
	}
	if originContext["source"] != deploy.SourceGitOps || originContext["adapter"] != deploy.AdapterGitCompose {
		t.Fatalf("expected git origin_context, got %v", originContext)
	}
	candidatePayload, ok := resolution.Metadata["candidate_payload"].(map[string]any)
	if !ok {
		t.Fatalf("expected candidate_payload map, got %T", resolution.Metadata["candidate_payload"])
	}
	if candidatePayload["repository_url"] != request.RepositoryURL || candidatePayload["compose_path"] != request.ComposePath {
		t.Fatalf("expected git candidate_payload, got %v", candidatePayload)
	}
	if resolution.Metadata["repository_url"] != request.RepositoryURL || resolution.Metadata["channel"] != "stable" {
		t.Fatalf("expected merged git metadata, got %v", resolution.Metadata)
	}
}

func TestBuildInstallIngressOptionsFromRawNormalizesRuntimeInputs(t *testing.T) {
	rawRuntimeInputs := map[string]any{
		"env": []any{
			map[string]any{"name": "APP_ENV", "kind": "shared-import", "set_id": "set_1", "var_id": "var_1"},
			map[string]any{"name": "JWT_SECRET", "kind": "sensitive", "generator_method": "password_32"},
		},
		"files": []any{
			map[string]any{"kind": "mount-file", "name": "config.yaml", "source_path": "./src/config.yaml", "mount_path": "./src/config.yaml", "uploaded": true},
		},
	}

	options := BuildInstallIngressOptionsFromRaw(
		"user_1",
		"",
		"",
		"",
		map[string]any{"APP_ENV": "dev"},
		nil,
		map[string]any{"channel": "stable"},
		rawRuntimeInputs,
		nil,
		0,
		0,
	)

	if options.RuntimeInputs == nil {
		t.Fatal("expected runtime inputs to be normalized")
	}
	if len(options.RuntimeInputs.Env) != 2 {
		t.Fatalf("expected 2 runtime env inputs, got %d", len(options.RuntimeInputs.Env))
	}
	if options.RuntimeInputs.Env[0].Kind != "shared-import" || options.RuntimeInputs.Env[0].SetID != "set_1" {
		t.Fatalf("expected normalized shared-import runtime input, got %+v", options.RuntimeInputs.Env[0])
	}
	if len(options.RuntimeInputs.Files) != 1 {
		t.Fatalf("expected 1 runtime file input, got %d", len(options.RuntimeInputs.Files))
	}
	if options.RuntimeInputs.Files[0].Kind != "mount-file" || options.RuntimeInputs.Files[0].SourcePath != "./src/config.yaml" {
		t.Fatalf("expected normalized mount-file input, got %+v", options.RuntimeInputs.Files[0])
	}
	if options.Metadata["channel"] != "stable" {
		t.Fatalf("expected metadata to survive, got %v", options.Metadata)
	}
}

func TestBuildInstallIngressOptionsFromRawNormalizesSourceBuild(t *testing.T) {
	rawSourceBuild := map[string]any{
		"source_kind":      "uploaded-package",
		"source_ref":       "upload://app.tar.gz",
		"workspace_ref":    "workspace://operations/demo/source",
		"builder_strategy": "buildpacks",
		"builder_inputs": map[string]any{
			"builder_image": "paketobuildpacks/builder-jammy-base",
		},
		"artifact_publication": map[string]any{
			"mode":                   "local",
			"credential_ref":         "secretref://registry/default",
			"image_name":             "apps/demo",
			"image_tag":              "main-20260401",
			"expected_artifact_kind": "oci-image",
		},
	}

	options := BuildInstallIngressOptionsFromRaw(
		"user_1",
		"",
		"",
		"",
		nil,
		nil,
		nil,
		nil,
		rawSourceBuild,
		0,
		0,
	)

	if options.SourceBuild == nil {
		t.Fatal("expected source_build to be normalized")
	}
	if options.SourceBuild.SourceKind != "uploaded-package" || options.SourceBuild.BuilderStrategy != "buildpacks" {
		t.Fatalf("expected normalized source_build fields, got %+v", options.SourceBuild)
	}
	if options.SourceBuild.ArtifactPublication == nil {
		t.Fatal("expected artifact_publication to be normalized")
	}
	if options.SourceBuild.ArtifactPublication.ImageName != "apps/demo" || options.SourceBuild.ArtifactPublication.Mode != "local" {
		t.Fatalf("expected normalized artifact_publication, got %+v", options.SourceBuild.ArtifactPublication)
	}
}

func TestBuildInstallIngressOptionsFromRawDefaultsSourceBuildPublicationModeToLocal(t *testing.T) {
	rawSourceBuild := map[string]any{
		"source_kind":      "uploaded-package",
		"source_ref":       "upload://app.tar.gz",
		"workspace_ref":    "workspace://operations/demo/source",
		"builder_strategy": "buildpacks",
		"artifact_publication": map[string]any{
			"image_name": "apps/demo",
		},
	}

	options := BuildInstallIngressOptionsFromRaw(
		"user_1",
		"",
		"",
		"",
		nil,
		nil,
		nil,
		nil,
		rawSourceBuild,
		0,
		0,
	)

	if options.SourceBuild == nil || options.SourceBuild.ArtifactPublication == nil {
		t.Fatal("expected source_build artifact_publication to be normalized")
	}
	if options.SourceBuild.ArtifactPublication.Mode != "local" {
		t.Fatalf("expected artifact_publication.mode to default to local, got %q", options.SourceBuild.ArtifactPublication.Mode)
	}
}

func TestNormalizedInstallSpecOperationSpecIncludesSourceBuild(t *testing.T) {
	spec := NormalizedInstallSpec{
		ServerID:           "local",
		ProjectName:        "demo",
		ComposeProjectName: "demo",
		ProjectDir:         "/appos/data/apps/operations/demo",
		RenderedCompose:    "services:\n  web:\n    image: nginx:alpine\n",
		OperationType:      "install",
		Source:             deploy.SourceManualOps,
		Adapter:            deploy.AdapterManualCompose,
		SourceBuild: &InstallSourceBuildInput{
			SourceKind:      "uploaded-package",
			SourceRef:       "upload://app.tar.gz",
			WorkspaceRef:    "workspace://operations/demo/source",
			BuilderStrategy: "buildpacks",
			ArtifactPublication: &InstallArtifactPublication{
				Mode:      "local",
				ImageName: "apps/demo",
			},
		},
	}

	op := spec.OperationSpec()
	if op["mode"] != "source-build" {
		t.Fatalf("expected mode=source-build, got %v", op["mode"])
	}
	sourceBuild, ok := op["source_build"].(map[string]any)
	if !ok {
		t.Fatalf("expected source_build map, got %T", op["source_build"])
	}
	if sourceBuild["source_kind"] != "uploaded-package" || sourceBuild["builder_strategy"] != "buildpacks" {
		t.Fatalf("unexpected source_build payload: %v", sourceBuild)
	}
}

func TestResolveInstallFromComposeRewritesSingleServiceSourceBuildCompose(t *testing.T) {
	spec, err := ResolveInstallFromCompose(nil, InstallResolutionRequest{
		ServerID:      "local",
		ProjectName:   "demo",
		Compose:       "services:\n  web:\n    image: nginx:alpine\n",
		OperationType: string(model.OperationTypeInstall),
		Source:        "manualops",
		Adapter:       "source-build",
		SourceBuild: &InstallSourceBuildInput{
			SourceKind:      "uploaded-package",
			SourceRef:       "upload://app.tar.gz",
			WorkspaceRef:    "workspace://operations/demo/source",
			BuilderStrategy: "buildpacks",
			ArtifactPublication: &InstallArtifactPublication{
				Mode:      "local",
				ImageName: "apps/demo",
			},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(spec.RenderedCompose, "image: apps/demo:candidate") {
		t.Fatalf("expected rendered_compose to target built local image, got %q", spec.RenderedCompose)
	}
	if strings.Contains(spec.RenderedCompose, "nginx:alpine") {
		t.Fatalf("expected rendered_compose to replace source image, got %q", spec.RenderedCompose)
	}
}

func TestResolveInstallFromComposeRejectsMultiServiceSourceBuildWithoutTargetService(t *testing.T) {
	_, err := ResolveInstallFromCompose(nil, InstallResolutionRequest{
		ServerID:      "local",
		ProjectName:   "demo",
		Compose:       "services:\n  web:\n    image: nginx:alpine\n  db:\n    image: postgres:16\n",
		OperationType: string(model.OperationTypeInstall),
		Source:        "manualops",
		Adapter:       "source-build",
		SourceBuild: &InstallSourceBuildInput{
			SourceKind:      "uploaded-package",
			SourceRef:       "upload://app.tar.gz",
			WorkspaceRef:    "workspace://operations/demo/source",
			BuilderStrategy: "buildpacks",
			ArtifactPublication: &InstallArtifactPublication{
				Mode:      "local",
				ImageName: "apps/demo",
			},
		},
	})
	if err == nil {
		t.Fatal("expected multi-service source build without target service to fail")
	}
	if got := err.Error(); got != "source_build.deploy_inputs.service_name is required for multi-service compose" {
		t.Fatalf("unexpected error: %s", got)
	}
}

func TestResolveInstallFromComposeUsesExplicitTargetServiceForMultiServiceSourceBuild(t *testing.T) {
	spec, err := ResolveInstallFromCompose(nil, InstallResolutionRequest{
		ServerID:      "local",
		ProjectName:   "demo",
		Compose:       "services:\n  web:\n    image: nginx:alpine\n  db:\n    image: postgres:16\n",
		OperationType: string(model.OperationTypeInstall),
		Source:        "manualops",
		Adapter:       "source-build",
		SourceBuild: &InstallSourceBuildInput{
			SourceKind:      "uploaded-package",
			SourceRef:       "upload://app.tar.gz",
			WorkspaceRef:    "workspace://operations/demo/source",
			BuilderStrategy: "buildpacks",
			ArtifactPublication: &InstallArtifactPublication{
				Mode:      "local",
				ImageName: "apps/demo",
			},
			DeployInputs: map[string]any{"service_name": "web"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(spec.RenderedCompose, "web:\n        image: apps/demo:candidate") && !strings.Contains(spec.RenderedCompose, "web:\n    image: apps/demo:candidate") {
		t.Fatalf("expected target service image to be rewritten, got %q", spec.RenderedCompose)
	}
	if !strings.Contains(spec.RenderedCompose, "image: postgres:16") {
		t.Fatalf("expected non-target services to remain unchanged, got %q", spec.RenderedCompose)
	}
}

func TestValidateRuntimeFileInputsRejectsInvalidFileKinds(t *testing.T) {
	err := validateRuntimeFileInputs(&InstallRuntimeInputs{
		Files: []InstallRuntimeFileInput{{
			Kind:       "overlay-bundle",
			Name:       "payload.tgz",
			SourcePath: "./src/payload.tgz",
		}},
	})
	if err == nil {
		t.Fatal("expected invalid runtime file kind to fail validation")
	}
	if got := err.Error(); got != "runtime_inputs.files[0]: unsupported kind \"overlay-bundle\"" {
		t.Fatalf("unexpected validation error: %s", got)
	}
}

func TestValidateRuntimeFileInputsRejectsMissingMountPath(t *testing.T) {
	err := validateRuntimeFileInputs(&InstallRuntimeInputs{
		Files: []InstallRuntimeFileInput{{
			Kind:       "mount-file",
			Name:       "config.yaml",
			SourcePath: "./src/config.yaml",
		}},
	})
	if err == nil {
		t.Fatal("expected mount-file without mount_path to fail validation")
	}
	if got := err.Error(); got != "runtime_inputs.files[0]: mount-file requires mount_path" {
		t.Fatalf("unexpected validation error: %s", got)
	}
}

func TestValidateSourceBuildInputRejectsMissingBuilderStrategy(t *testing.T) {
	err := validateSourceBuildInput(&InstallSourceBuildInput{
		SourceKind:   "uploaded-package",
		SourceRef:    "upload://app.tar.gz",
		WorkspaceRef: "workspace://operations/demo/source",
		ArtifactPublication: &InstallArtifactPublication{
			Mode:      "local",
			ImageName: "apps/demo",
		},
	})
	if err == nil {
		t.Fatal("expected missing builder_strategy to fail validation")
	}
	if got := err.Error(); got != "source_build.builder_strategy is required" {
		t.Fatalf("unexpected validation error: %s", got)
	}
}

func TestValidateSourceBuildInputDefaultsMissingPublicationModeToLocal(t *testing.T) {
	input := &InstallSourceBuildInput{
		SourceKind:      "uploaded-package",
		SourceRef:       "upload://app.tar.gz",
		WorkspaceRef:    "workspace://operations/demo/source",
		BuilderStrategy: "buildpacks",
		ArtifactPublication: &InstallArtifactPublication{
			ImageName: "apps/demo",
		},
	}

	if err := validateSourceBuildInput(input); err != nil {
		t.Fatalf("expected missing publication mode to default to local, got %v", err)
	}
	if input.ArtifactPublication.Mode != "local" {
		t.Fatalf("expected validation to default publication mode to local, got %q", input.ArtifactPublication.Mode)
	}
}

func TestValidateSourceBuildInputRejectsPushWithoutTargetRef(t *testing.T) {
	err := validateSourceBuildInput(&InstallSourceBuildInput{
		SourceKind:      "uploaded-package",
		SourceRef:       "upload://app.tar.gz",
		WorkspaceRef:    "workspace://operations/demo/source",
		BuilderStrategy: "buildpacks",
		ArtifactPublication: &InstallArtifactPublication{
			Mode:      "push",
			ImageName: "apps/demo",
		},
	})
	if err == nil {
		t.Fatal("expected push without target_ref to fail validation")
	}
	if got := err.Error(); got != "source_build.artifact_publication.target_ref is required when mode=push" {
		t.Fatalf("unexpected validation error: %s", got)
	}
}
