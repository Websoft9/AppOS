package worker

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/config/sysconfig"
	settingsschema "github.com/websoft9/appos/backend/domain/config/sysconfig/schema"
	"gopkg.in/yaml.v3"
)

var deploymentImagePullTimeout = 3 * time.Minute

type deploymentImageClient interface {
	ImageInspect(ctx context.Context, id string) (string, error)
	ImagePull(ctx context.Context, name string) (string, error)
	ImageTag(ctx context.Context, sourceRef string, targetRef string) (string, error)
}

func prepareDeploymentImages(
	ctx context.Context,
	app core.App,
	client deploymentImageClient,
	rawCompose string,
	logf func(string),
) error {
	images, err := extractComposeImageReferences(rawCompose)
	if err != nil {
		return err
	}
	if len(images) == 0 {
		return nil
	}

	mirrors := loadDeploymentDockerMirrors(app)
	for _, image := range images {
		if err := ensureDeploymentImageReady(ctx, client, image, mirrors, logf); err != nil {
			return err
		}
	}
	return nil
}

func ensureDeploymentImageReady(
	ctx context.Context,
	client deploymentImageClient,
	image string,
	mirrors []string,
	logf func(string),
) error {
	if _, err := client.ImageInspect(ctx, image); err == nil {
		logf("docker image already available locally: " + image)
		return nil
	}

	logf("docker image pull started: " + image)
	if _, err := pullDeploymentImageWithTimeout(ctx, client, image); err == nil {
		logf("docker image pull succeeded: " + image)
		return nil
	} else {
		logf("docker image pull failed: " + image + ": " + err.Error())
		if len(mirrors) == 0 {
			return err
		}
	}

	if strings.Contains(image, "@") {
		return fmt.Errorf("image pull failed for %s and mirror fallback is not supported for digest-pinned references", image)
	}

	var mirrorErrors []string
	for _, mirror := range mirrors {
		mirrorRef, ok := buildMirroredImageReference(image, mirror)
		if !ok || mirrorRef == image {
			continue
		}
		logf(fmt.Sprintf("docker image mirror pull started: %s via %s", image, mirrorRef))
		if _, err := pullDeploymentImageWithTimeout(ctx, client, mirrorRef); err != nil {
			mirrorErrors = append(mirrorErrors, fmt.Sprintf("%s: %v", mirrorRef, err))
			logf(fmt.Sprintf("docker image mirror pull failed: %s", err.Error()))
			continue
		}
		if _, err := client.ImageTag(ctx, mirrorRef, image); err != nil {
			mirrorErrors = append(mirrorErrors, fmt.Sprintf("tag %s -> %s: %v", mirrorRef, image, err))
			logf(fmt.Sprintf("docker image mirror tag failed: %s", err.Error()))
			continue
		}
		logf(fmt.Sprintf("docker image mirror pull succeeded: %s via %s", image, mirrorRef))
		return nil
	}

	if len(mirrorErrors) == 0 {
		return fmt.Errorf("image pull failed for %s", image)
	}
	return fmt.Errorf("image pull failed for %s; mirror attempts failed: %s", image, strings.Join(mirrorErrors, "; "))
}

func pullDeploymentImageWithTimeout(ctx context.Context, client deploymentImageClient, image string) (string, error) {
	pullCtx, cancel := context.WithTimeout(ctx, deploymentImagePullTimeout)
	defer cancel()

	output, err := client.ImagePull(pullCtx, image)
	if err != nil {
		if errorsIsTimeout(err) || pullCtx.Err() == context.DeadlineExceeded {
			return "", fmt.Errorf("timed out pulling image %s after %s", image, deploymentImagePullTimeout)
		}
		return "", err
	}
	return output, nil
}

func errorsIsTimeout(err error) bool {
	return err == context.DeadlineExceeded || err == context.Canceled || strings.Contains(strings.ToLower(err.Error()), "deadline exceeded")
}

func extractComposeImageReferences(raw string) ([]string, error) {
	if strings.TrimSpace(raw) == "" {
		return nil, nil
	}

	var doc map[string]any
	if err := yaml.Unmarshal([]byte(raw), &doc); err != nil {
		return nil, fmt.Errorf("parse compose for image preparation: %w", err)
	}

	rawServices, ok := doc["services"]
	if !ok {
		return nil, nil
	}
	services, ok := rawServices.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("parse compose for image preparation: services must be a map")
	}

	imageSet := make(map[string]struct{})
	for _, rawService := range services {
		service, ok := rawService.(map[string]any)
		if !ok {
			continue
		}
		image := strings.TrimSpace(fmt.Sprint(service["image"]))
		if image == "" || image == "<nil>" {
			continue
		}
		imageSet[image] = struct{}{}
	}

	images := make([]string, 0, len(imageSet))
	for image := range imageSet {
		images = append(images, image)
	}
	sort.Strings(images)
	return images, nil
}

func loadDeploymentDockerMirrors(app core.App) []string {
	group, _ := sysconfig.GetGroup(
		app,
		"docker",
		"mirror",
		settingsschema.DefaultGroup("docker", "mirror"),
	)
	rawMirrors, _ := group["mirrors"].([]any)
	if len(rawMirrors) == 0 {
		return nil
	}
	seen := make(map[string]struct{}, len(rawMirrors))
	mirrors := make([]string, 0, len(rawMirrors))
	for _, rawMirror := range rawMirrors {
		mirror := strings.TrimSpace(fmt.Sprint(rawMirror))
		mirror = strings.TrimPrefix(strings.TrimPrefix(mirror, "https://"), "http://")
		mirror = strings.TrimSuffix(mirror, "/")
		if mirror == "" {
			continue
		}
		if _, ok := seen[mirror]; ok {
			continue
		}
		seen[mirror] = struct{}{}
		mirrors = append(mirrors, mirror)
	}
	return mirrors
}

func buildMirroredImageReference(image string, mirror string) (string, bool) {
	trimmedImage := strings.TrimSpace(image)
	trimmedMirror := strings.TrimSpace(mirror)
	if trimmedImage == "" || trimmedMirror == "" {
		return "", false
	}

	namePart := trimmedImage
	suffix := ""
	if index := strings.Index(trimmedImage, "@"); index >= 0 {
		namePart = trimmedImage[:index]
		suffix = trimmedImage[index:]
	} else if index := strings.LastIndex(trimmedImage, ":"); index > strings.LastIndex(trimmedImage, "/") {
		namePart = trimmedImage[:index]
		suffix = trimmedImage[index:]
	}

	segments := strings.Split(namePart, "/")
	if len(segments) == 0 {
		return "", false
	}

	registry := ""
	repository := namePart
	first := segments[0]
	if strings.Contains(first, ".") || strings.Contains(first, ":") || first == "localhost" {
		registry = first
		repository = strings.Join(segments[1:], "/")
	}
	if repository == "" {
		return "", false
	}
	if registry == "" && !strings.Contains(repository, "/") {
		repository = "library/" + repository
	}

	if registry != "" {
		return trimmedMirror + "/" + registry + "/" + repository + suffix, true
	}
	return trimmedMirror + "/" + repository + suffix, true
}