package installprobe

import "testing"

func TestParseDiskSpaceOutputGNUFormat(t *testing.T) {
	availableBytes, mountPoint, err := parseDiskSpaceOutput("1048576 /appos/data")
	if err != nil {
		t.Fatalf("parseDiskSpaceOutput() error = %v", err)
	}
	if availableBytes != 1073741824 {
		t.Fatalf("expected 1073741824 bytes, got %d", availableBytes)
	}
	if mountPoint != "/appos/data" {
		t.Fatalf("expected mount point /appos/data, got %q", mountPoint)
	}
}

func TestParseDiskSpaceOutputPOSIXFormat(t *testing.T) {
	availableBytes, mountPoint, err := parseDiskSpaceOutput("/dev/sda1 2097152 1024 1048576 1% /appos/data")
	if err != nil {
		t.Fatalf("parseDiskSpaceOutput() error = %v", err)
	}
	if availableBytes != 1073741824 {
		t.Fatalf("expected 1073741824 bytes, got %d", availableBytes)
	}
	if mountPoint != "/appos/data" {
		t.Fatalf("expected mount point /appos/data, got %q", mountPoint)
	}
}

func TestParseDiskSpaceOutputRejectsUnexpectedFormat(t *testing.T) {
	if _, _, err := parseDiskSpaceOutput("df failed"); err == nil {
		t.Fatal("expected parseDiskSpaceOutput() to reject unexpected output")
	}
}
