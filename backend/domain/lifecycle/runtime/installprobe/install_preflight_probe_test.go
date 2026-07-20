package installprobe

import (
	"testing"

	"github.com/websoft9/appos/backend/domain/runtimepaths"
)

func TestParseDiskSpaceOutputGNUFormat(t *testing.T) {
	dataRoot := runtimepaths.DataRoot()
	availableBytes, mountPoint, err := parseDiskSpaceOutput("1048576 " + dataRoot)
	if err != nil {
		t.Fatalf("parseDiskSpaceOutput() error = %v", err)
	}
	if availableBytes != 1073741824 {
		t.Fatalf("expected 1073741824 bytes, got %d", availableBytes)
	}
	if mountPoint != dataRoot {
		t.Fatalf("expected mount point %s, got %q", dataRoot, mountPoint)
	}
}

func TestParseDiskSpaceOutputPOSIXFormat(t *testing.T) {
	dataRoot := runtimepaths.DataRoot()
	availableBytes, mountPoint, err := parseDiskSpaceOutput("/dev/sda1 2097152 1024 1048576 1% " + dataRoot)
	if err != nil {
		t.Fatalf("parseDiskSpaceOutput() error = %v", err)
	}
	if availableBytes != 1073741824 {
		t.Fatalf("expected 1073741824 bytes, got %d", availableBytes)
	}
	if mountPoint != dataRoot {
		t.Fatalf("expected mount point %s, got %q", dataRoot, mountPoint)
	}
}

func TestParseDiskSpaceOutputRejectsUnexpectedFormat(t *testing.T) {
	if _, _, err := parseDiskSpaceOutput("df failed"); err == nil {
		t.Fatal("expected parseDiskSpaceOutput() to reject unexpected output")
	}
}
