package secrets

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	cryptossh "golang.org/x/crypto/ssh"
)

func validateTemplateSpecificPayload(payload map[string]any, tpl Template) error {
	switch tpl.ID {
	case "ssh_key":
		return validateSSHKeyPayload(payload)
	default:
		return nil
	}
}

func validateSSHKeyPayload(payload map[string]any) error {
	privateKey := strings.TrimSpace(FirstStringFromPayload(payload, "private_key", "key", "value"))
	passphrase := FirstStringFromPayload(payload, "passphrase")

	if privateKey == "" {
		return fmt.Errorf("required field is empty: private_key")
	}
	if looksLikePuTTYPrivateKey(privateKey) {
		return fmt.Errorf("ssh_key payload does not support PuTTY PPK files; provide an OpenSSH or PEM private key")
	}
	if looksLikeSSHPublicKey(privateKey) {
		return fmt.Errorf("ssh_key payload must contain an SSH private key, not a public key")
	}

	_, err := cryptossh.ParsePrivateKey([]byte(privateKey))
	if err == nil {
		return nil
	}

	var passphraseMissing *cryptossh.PassphraseMissingError
	if errors.As(err, &passphraseMissing) {
		if passphrase == "" {
			return fmt.Errorf("encrypted SSH private key requires a passphrase")
		}
		if _, err := cryptossh.ParsePrivateKeyWithPassphrase([]byte(privateKey), []byte(passphrase)); err != nil {
			return fmt.Errorf("ssh_key payload must contain a valid SSH private key and matching passphrase: %w", err)
		}
		return nil
	}

	return fmt.Errorf("ssh_key payload must contain a valid SSH private key")
}

func looksLikePuTTYPrivateKey(value string) bool {
	return strings.HasPrefix(strings.TrimSpace(value), "PuTTY-User-Key-File-")
}

func looksLikeSSHPublicKey(value string) bool {
	trimmed := strings.TrimSpace(value)
	upper := strings.ToUpper(trimmed)
	if strings.Contains(upper, "BEGIN PUBLIC KEY") || strings.Contains(upper, "BEGIN SSH2 PUBLIC KEY") {
		return true
	}
	fields := strings.Fields(trimmed)
	if len(fields) >= 2 {
		switch fields[0] {
		case "ssh-ed25519", "ssh-rsa", "ssh-dss":
			return true
		}
		if strings.HasPrefix(fields[0], "ecdsa-sha2-") || strings.HasPrefix(fields[0], "sk-") {
			return true
		}
	}
	_, _, _, _, err := cryptossh.ParseAuthorizedKey([]byte(trimmed))
	return err == nil
}

func decodePayloadMetaMap(raw any) map[string]any {
	switch typed := raw.(type) {
	case map[string]any:
		return typed
	case []byte:
		var decoded map[string]any
		if err := json.Unmarshal(typed, &decoded); err == nil {
			return decoded
		}
	case string:
		var decoded map[string]any
		if err := json.Unmarshal([]byte(typed), &decoded); err == nil {
			return decoded
		}
	}
	serialized := strings.TrimSpace(fmt.Sprintf("%s", raw))
	if serialized == "" {
		return nil
	}
	var decoded map[string]any
	if err := json.Unmarshal([]byte(serialized), &decoded); err == nil {
		return decoded
	}
	return nil
}
