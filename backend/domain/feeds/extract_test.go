package feeds

import "testing"

func TestExtractKeywordsAndTags(t *testing.T) {
	keywords := ExtractKeywords(
		"Security Release: Breaking Change Ahead",
		"Patch maintenance update with CVE fixes and deprecation notice.",
	)
	if len(keywords) == 0 {
		t.Fatal("expected keywords to be extracted")
	}
	tags := ExtractTags(keywords)
	expected := []string{"release", "security", "breaking-change", "maintenance"}
	if len(tags) != len(expected) {
		t.Fatalf("expected %d tags, got %#v", len(expected), tags)
	}
	for i, want := range expected {
		if tags[i] != want {
			t.Fatalf("expected tag %q at %d, got %#v", want, i, tags)
		}
	}
}