package workflow

import "testing"

func TestParseDefinitionSuccess(t *testing.T) {
	def, err := ParseDefinition(`
name: sample
default_server_id: srv_1
triggers:
  - type: cron
    schedule: '0 6 * * *'
nodes:
  - key: collect
    type: shell
    config:
      command: echo ok
  - key: analyze
    type: llm
    depends_on: [collect]
    config:
      prompt: hi
`)
	if err != nil {
		t.Fatalf("ParseDefinition: %v", err)
	}
	if def.Name != "sample" {
		t.Fatalf("expected name sample, got %q", def.Name)
	}
	if len(def.Nodes) != 2 {
		t.Fatalf("expected 2 nodes, got %d", len(def.Nodes))
	}
}

func TestParseDefinitionRejectsCycle(t *testing.T) {
	_, err := ParseDefinition(`
name: sample
nodes:
  - key: a
    type: llm
    depends_on: [b]
  - key: b
    type: llm
    depends_on: [a]
`)
	if err == nil {
		t.Fatal("expected cycle error")
	}
}

func TestParseDefinitionRequiresServerForShell(t *testing.T) {
	_, err := ParseDefinition(`
name: sample
nodes:
  - key: a
    type: shell
    config:
      command: echo ok
`)
	if err == nil {
		t.Fatal("expected default_server_id error")
	}
}

func TestCronSchedules(t *testing.T) {
	schedules, err := CronSchedules(`
name: sample
triggers:
  - type: cron
    schedule: '0 6 * * *'
nodes:
  - key: a
    type: llm
    config:
      prompt: hi
`)
	if err != nil {
		t.Fatalf("CronSchedules: %v", err)
	}
	if len(schedules) != 1 || schedules[0] != "0 6 * * *" {
		t.Fatalf("unexpected schedules: %#v", schedules)
	}
}
