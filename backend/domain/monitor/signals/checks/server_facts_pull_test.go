package checks

import "testing"

func TestParseServerFactsCommandOutput(t *testing.T) {
	facts, err := ParseServerFactsCommandOutput(`os.family=Linux
os.distribution=Ubuntu
os.version=24.04
kernel.release=6.8.0-31-generic
architecture=x86_64
cpu.cores=4
memory.total_bytes=8589934592
cloud.provider=aws
cloud.region=cn-northwest-1
cloud.zone=cn-northwest-1a
cloud.source=cloud-init
`)
	if err != nil {
		t.Fatal(err)
	}
	osFacts := facts["os"].(map[string]any)
	if osFacts["distribution"] != "Ubuntu" {
		t.Fatalf("expected Ubuntu distribution, got %+v", facts)
	}
	cpuFacts := facts["cpu"].(map[string]any)
	if cpuFacts["cores"] != int64(4) {
		t.Fatalf("expected 4 cpu cores, got %+v", facts)
	}
	memoryFacts := facts["memory"].(map[string]any)
	if memoryFacts["total_bytes"] != int64(8589934592) {
		t.Fatalf("expected memory total bytes, got %+v", facts)
	}
	cloudFacts := facts["cloud"].(map[string]any)
	if cloudFacts["provider"] != "aws" || cloudFacts["region"] != "cn-northwest-1" || cloudFacts["zone"] != "cn-northwest-1a" || cloudFacts["source"] != "cloud-init" {
		t.Fatalf("expected cloud facts, got %+v", facts)
	}
}

func TestParseServerFactsCommandOutputRejectsMissingRequiredField(t *testing.T) {
	_, err := ParseServerFactsCommandOutput(`os.family=Linux
os.distribution=Ubuntu
os.version=24.04
kernel.release=6.8.0-31-generic
architecture=x86_64
cpu.cores=4
`)
	if err == nil {
		t.Fatal("expected missing memory.total_bytes error")
	}
}

func TestParseServerFactsCommandOutputTreatsCloudFieldsAsOptional(t *testing.T) {
	facts, err := ParseServerFactsCommandOutput(`os.family=Linux
os.distribution=Ubuntu
os.version=24.04
kernel.release=6.8.0-31-generic
architecture=x86_64
cpu.cores=4
memory.total_bytes=8589934592
cloud.provider=
`)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := facts["cloud"]; ok {
		t.Fatalf("expected no cloud facts group, got %+v", facts)
	}
}
