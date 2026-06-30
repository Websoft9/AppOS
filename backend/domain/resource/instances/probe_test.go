package instances

import "testing"

func TestResolveProbeTargetUsesExplicitEndpointPort(t *testing.T) {
	item := RestoreInstance(Snapshot{
		Name:       "s3-storage",
		Kind:       KindS3Compatible,
		TemplateID: "generic-s3",
		Endpoint:   "https://s3.example.com:9443",
	})

	target, err := ResolveProbeTarget(item)
	if err != nil {
		t.Fatal(err)
	}
	if target.Host != "s3.example.com" || target.Port != 9443 || target.Scheme != "https" {
		t.Fatalf("unexpected target: %+v", target)
	}
}

func TestResolveProbeTargetUsesTemplateDefaultPort(t *testing.T) {
	item := RestoreInstance(Snapshot{
		Name:       "mq-rabbit",
		Kind:       KindAMQPCompatible,
		TemplateID: "generic-rabbitmq",
		Endpoint:   "amqp://rabbitmq.internal",
	})

	target, err := ResolveProbeTarget(item)
	if err != nil {
		t.Fatal(err)
	}
	if target.Host != "rabbitmq.internal" || target.Port != 5672 || target.Scheme != "amqp" {
		t.Fatalf("unexpected target: %+v", target)
	}
}

func TestResolveProbeTargetUsesKindFallbackPort(t *testing.T) {
	item := RestoreInstance(Snapshot{
		Name:       "mysql-primary",
		Kind:       KindMySQLCompatible,
		TemplateID: "generic-mysql",
		Endpoint:   "db.internal",
	})

	target, err := ResolveProbeTarget(item)
	if err != nil {
		t.Fatal(err)
	}
	if target.Host != "db.internal" || target.Port != 3306 {
		t.Fatalf("unexpected target: %+v", target)
	}
}

func TestResolveProbeTargetUsesSchemeFallbackPort(t *testing.T) {
	item := RestoreInstance(Snapshot{
		Name:       "s3-storage",
		Kind:       KindS3Compatible,
		TemplateID: "generic-s3",
		Endpoint:   "https://s3.example.com",
	})

	target, err := ResolveProbeTarget(item)
	if err != nil {
		t.Fatal(err)
	}
	if target.Host != "s3.example.com" || target.Port != 443 || target.Scheme != "https" {
		t.Fatalf("unexpected target: %+v", target)
	}
}

func TestResolveProbeTargetRejectsEmptyEndpoint(t *testing.T) {
	item := RestoreInstance(Snapshot{Name: "bad", Kind: KindRedisCompatible, TemplateID: "generic-redis"})

	_, err := ResolveProbeTarget(item)
	if err == nil || err.Error() != "instance endpoint is empty" {
		t.Fatalf("expected empty endpoint error, got %v", err)
	}
}
