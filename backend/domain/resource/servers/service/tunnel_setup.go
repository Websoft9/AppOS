package service

import (
	"bytes"
	"fmt"
	"strings"
	"text/template"

	servers "github.com/websoft9/appos/backend/domain/resource/servers"
	tunnelcore "github.com/websoft9/appos/backend/infra/tunnelcore"
)

func (s TunnelService) BuildSetup(managedServer *servers.ManagedServer, token, apposHost, sshPort string) (TunnelSetupResult, error) {
	forwards, err := managedServer.TunnelForwardSpecs()
	if err != nil {
		return TunnelSetupResult{}, fmt.Errorf("parse forwards: %w", err)
	}

	return TunnelSetupResult{
		Token:          token,
		AutosshCmd:     buildTunnelAutosshCommand(forwards, sshPort, token, apposHost),
		SystemdUnit:    buildTunnelSystemdUnit(forwards, sshPort, token, apposHost),
		SetupScriptURL: fmt.Sprintf("/tunnel/setup/%s", token),
		Forwards:       ForwardSpecsToResponse(forwards),
	}, nil
}

func (s TunnelService) BuildSetupScript(managedServer *servers.ManagedServer, token, apposHost, sshPort string) (string, error) {
	forwards, err := managedServer.TunnelForwardSpecs()
	if err != nil {
		return "", fmt.Errorf("parse forwards: %w", err)
	}
	execStartArgs := buildTunnelExecArgs(forwards, "${SSH_PORT}", "${TOKEN}", "${APPOS_HOST}")

	var buf bytes.Buffer
	if err := setupScriptTmpl.Execute(&buf, setupScriptData{
		Token:         token,
		ApposHost:     apposHost,
		SSHPort:       sshPort,
		ExecStartArgs: execStartArgs,
	}); err != nil {
		return "", fmt.Errorf("render setup script: %w", err)
	}
	return buf.String(), nil
}

type setupScriptData struct {
	Token         string
	ApposHost     string
	SSHPort       string
	ExecStartArgs string
}

var setupScriptTmpl = template.Must(template.New("setup").Parse(`#!/bin/bash
# appos tunnel setup script
# Auto-generated — do not edit

set -e

TOKEN="{{.Token}}"
APPOS_HOST="{{.ApposHost}}"
SSH_PORT="{{.SSHPort}}"

# ── Determine tunnel binary (autossh preferred, ssh as fallback) ─────────────
USE_AUTOSSH=false
if command -v autossh &>/dev/null; then
  USE_AUTOSSH=true
else
  echo "autossh not found, attempting install..."
  if command -v apt-get &>/dev/null; then
    apt-get install -y autossh 2>/dev/null && USE_AUTOSSH=true
  elif command -v yum &>/dev/null; then
    yum install -y autossh 2>/dev/null && USE_AUTOSSH=true
  elif command -v dnf &>/dev/null; then
    dnf install -y autossh 2>/dev/null && USE_AUTOSSH=true
  elif command -v zypper &>/dev/null; then
    zypper install -y autossh 2>/dev/null && USE_AUTOSSH=true
  fi
  if [ "$USE_AUTOSSH" = false ]; then
    echo "WARNING: autossh could not be installed. Falling back to plain ssh." >&2
  fi
fi

# ── Build ExecStart depending on available binary ────────────────────────────
if [ "$USE_AUTOSSH" = true ]; then
	EXEC_START="/usr/bin/autossh {{.ExecStartArgs}}"
else
	EXEC_START="/usr/bin/ssh {{.ExecStartArgs}}"
fi

# ── Write systemd unit ────────────────────────────────────────────────────────
cat >/etc/systemd/system/appos-tunnel.service <<EOF
[Unit]
Description=appos reverse SSH tunnel
After=network-online.target
Wants=network-online.target
StartLimitIntervalSec=0

[Service]
Type=simple
Environment=AUTOSSH_GATETIME=0
ExecStart=${EXEC_START}
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

# ── Stop existing service if already running ─────────────────────────────────
systemctl stop appos-tunnel 2>/dev/null || true

# ── Enable and start ──────────────────────────────────────────────────────────
systemctl daemon-reload
systemctl enable --now appos-tunnel

if [ "$USE_AUTOSSH" = true ]; then
  echo "✓ appos-tunnel service enabled and started (autossh)."
else
  echo "✓ appos-tunnel service enabled and started (ssh fallback)."
fi
echo "  Run: systemctl status appos-tunnel"
`))

func buildTunnelExecArgs(forwards []tunnelcore.ForwardSpec, sshPort, token, apposHost string) string {
	parts := []string{"-M 0", "-N"}
	for _, forward := range forwards {
		parts = append(parts, fmt.Sprintf("-R 0:localhost:%d", forward.LocalPort))
	}
	parts = append(parts,
		fmt.Sprintf("-p %s", sshPort),
		fmt.Sprintf("%s@%s", token, apposHost),
		"-o ServerAliveInterval=30",
		"-o ServerAliveCountMax=3",
		"-o StrictHostKeyChecking=no",
		"-o UserKnownHostsFile=/dev/null",
		"-o ExitOnForwardFailure=yes",
	)
	return strings.Join(parts, " ")
}

func buildTunnelAutosshCommand(forwards []tunnelcore.ForwardSpec, sshPort, token, apposHost string) string {
	cont := " " + string('\\')
	lines := []string{"autossh -M 0 -N" + cont}
	for _, forward := range forwards {
		lines = append(lines, fmt.Sprintf("  -R 0:localhost:%d%s", forward.LocalPort, cont))
	}
	lines = append(lines,
		fmt.Sprintf("  -p %s %s@%s%s", sshPort, token, apposHost, cont),
		"  -o ServerAliveInterval=30"+cont,
		"  -o ServerAliveCountMax=3"+cont,
		"  -o StrictHostKeyChecking=no"+cont,
		"  -o UserKnownHostsFile=/dev/null"+cont,
		"  -o ExitOnForwardFailure=yes",
	)
	return strings.Join(lines, "\n")
}

func buildTunnelSystemdUnit(forwards []tunnelcore.ForwardSpec, sshPort, token, apposHost string) string {
	args := strings.ReplaceAll(buildTunnelAutosshCommand(forwards, sshPort, token, apposHost), "autossh ", "")
	return fmt.Sprintf(`[Unit]
Description=appos reverse SSH tunnel
After=network-online.target
Wants=network-online.target
StartLimitIntervalSec=0

[Service]
Type=simple
Environment=AUTOSSH_GATETIME=0
ExecStart=/usr/bin/autossh %s
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target`, args)
}
