package servers

// DefaultMaxConcurrentDockerImagePullsPerServer is the current built-in limit
// for concurrently executing docker pull commands on the same server.
//
// Keep worker callers behind MaxConcurrentDockerImagePullsPerServer so this can
// later move to a configurable source without changing call sites.
const DefaultMaxConcurrentDockerImagePullsPerServer = 2

func MaxConcurrentDockerImagePullsPerServer() int {
	return DefaultMaxConcurrentDockerImagePullsPerServer
}
