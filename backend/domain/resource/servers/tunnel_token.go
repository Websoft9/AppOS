package servers

const TunnelTokenSecretPrefix = "tunnel-token-"

// TunnelTokenSecretName returns the canonical secret record name for a server tunnel token.
func TunnelTokenSecretName(serverID string) string {
	return TunnelTokenSecretPrefix + serverID
}