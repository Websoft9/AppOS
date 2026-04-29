package audit

import "testing"

func TestValidStatusesIncludesAttentionRequired(t *testing.T) {
	if !validStatuses[StatusAttentionRequired] {
		t.Fatalf("expected audit status %q to be accepted", StatusAttentionRequired)
	}
}
