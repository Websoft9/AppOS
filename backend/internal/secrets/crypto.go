package secrets

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
)

type encryptedBlob struct {
	Nonce      string `json:"nonce"`
	Ciphertext string `json:"ciphertext"`
}

func EncryptPayload(payload map[string]any) (string, error) {
	key, err := currentKey()
	if err != nil {
		return "", err
	}
	plain, err := json.Marshal(payload)
	if err != nil {
		return "", fmt.Errorf("marshal payload: %w", err)
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}

	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}

	sealed := gcm.Seal(nil, nonce, plain, nil)
	blob := encryptedBlob{
		Nonce:      base64.StdEncoding.EncodeToString(nonce),
		Ciphertext: base64.StdEncoding.EncodeToString(sealed),
	}
	out, err := json.Marshal(blob)
	if err != nil {
		return "", fmt.Errorf("marshal encrypted blob: %w", err)
	}
	return string(out), nil
}

func DecryptPayload(encrypted string) (map[string]any, error) {
	key, err := currentKey()
	if err != nil {
		return nil, err
	}

	var blob encryptedBlob
	if err := json.Unmarshal([]byte(encrypted), &blob); err != nil {
		return nil, fmt.Errorf("invalid encrypted payload format: %w", err)
	}
	nonce, err := base64.StdEncoding.DecodeString(blob.Nonce)
	if err != nil {
		return nil, fmt.Errorf("invalid nonce encoding: %w", err)
	}
	ciphertext, err := base64.StdEncoding.DecodeString(blob.Ciphertext)
	if err != nil {
		return nil, fmt.Errorf("invalid ciphertext encoding: %w", err)
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}

	if len(nonce) != gcm.NonceSize() {
		return nil, fmt.Errorf("invalid nonce length: expected %d, got %d", gcm.NonceSize(), len(nonce))
	}

	plain, err := gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return nil, fmt.Errorf("decrypt payload: %w", err)
	}

	var payload map[string]any
	if err := json.Unmarshal(plain, &payload); err != nil {
		return nil, fmt.Errorf("unmarshal payload: %w", err)
	}
	if payload == nil {
		payload = map[string]any{}
	}
	return payload, nil
}
