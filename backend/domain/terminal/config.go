package terminal

// CredAuthType identifies the authentication method used to connect to a server.
type CredAuthType string

const (
	// AuthMethodPassword authenticates using a username/password pair.
	AuthMethodPassword CredAuthType = "password"
	// AuthMethodPrivateKey authenticates using an SSH private key (PEM).
	AuthMethodPrivateKey CredAuthType = "private_key"
)

// ConnectorConfig carries the transport parameters required to open a terminal connection.
// For SSH-backed connectors (SSHConnector, SFTPClient) this maps to SSH session inputs.
// DockerExecConnector overloads Host as the container ID.
type ConnectorConfig struct {
	// Host is the target hostname or IP address (SSH) or container ID (Docker exec).
	Host string
	// Port is the target TCP port (e.g. 22 for SSH). Unused for Docker exec.
	Port int
	// User is the login username.
	User string
	// AuthType identifies the credential kind: AuthMethodPassword or AuthMethodPrivateKey.
	// Unused for Docker exec.
	AuthType CredAuthType
	// Secret is the decrypted credential value (password or PEM private key).
	// Unused for Docker exec.
	Secret string
	// Shell overrides the login shell (empty = server default).
	Shell string
}
