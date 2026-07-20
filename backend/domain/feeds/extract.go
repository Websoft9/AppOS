package feeds

import (
	"regexp"
	"strings"
)

var tokenPattern = regexp.MustCompile(`[a-z0-9]+(?:[-_][a-z0-9]+)*`)

func ExtractKeywords(title, summary string) []string {
	text := strings.ToLower(strings.TrimSpace(title + " " + summary))
	if text == "" {
		return nil
	}
	matches := tokenPattern.FindAllString(text, -1)
	return normalizeStringList(matches)
}

func ExtractTags(keywords []string) []string {
	set := make(map[string]struct{}, len(keywords))
	for _, keyword := range normalizeStringList(keywords) {
		set[keyword] = struct{}{}
	}

	tags := make([]string, 0, 4)
	appendTag := func(tag string) {
		for _, existing := range tags {
			if existing == tag {
				return
			}
		}
		tags = append(tags, tag)
	}

	if hasAny(set, "release", "released", "version", "ga") {
		appendTag("release")
	}
	if hasAny(set, "security", "cve", "vulnerability", "vulnerabilities", "exploit") {
		appendTag("security")
	}
	if hasAny(set, "breaking-change", "breaking", "deprecation", "deprecated") || (has(set, "breaking") && has(set, "change")) {
		appendTag("breaking-change")
	}
	if hasAny(set, "maintenance", "patch", "bugfix", "fixes", "fix") {
		appendTag("maintenance")
	}

	return tags
}

func has(set map[string]struct{}, key string) bool {
	_, ok := set[key]
	return ok
}

func hasAny(set map[string]struct{}, keys ...string) bool {
	for _, key := range keys {
		if has(set, key) {
			return true
		}
	}
	return false
}
