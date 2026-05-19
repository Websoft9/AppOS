package worker

import (
	"testing"

	servers "github.com/websoft9/appos/backend/domain/resource/servers"
)

func TestDockerImagePullServerSemaphoreUsesDefaultServerLimit(t *testing.T) {
	serverID := "server-limit-test"
	sem := dockerImagePullServerSemaphore(serverID)

	if got, want := cap(sem), servers.MaxConcurrentDockerImagePullsPerServer(); got != want {
		t.Fatalf("expected semaphore capacity %d, got %d", want, got)
	}

	sem <- struct{}{}
	sem <- struct{}{}
	select {
	case sem <- struct{}{}:
		t.Fatal("expected third pull slot acquisition to block when server limit is reached")
	default:
	}

	<-sem
	<-sem
}