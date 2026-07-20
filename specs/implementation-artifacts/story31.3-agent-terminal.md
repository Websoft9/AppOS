# Story 31.3: Agent Terminal

**Epic**: Epic 31 - AI Runtime
**Status**: draft | **Priority**: P2 | **Depends on**: Story 31.1 Chat MVP, Story 15.1 Terminal UI

## Decision Summary

AppOS AI Copilot has **two modes**:

| Mode | Route | UX | Purpose |
|---|---|---|---|
| Chat | `/ai-copilot` | Markdown conversation | Lightweight Q&A |
| Terminal | `/ai-terminal` | xterm.js PTY | CLI agent workspace |

They are **separate pages** because they need different layouts (chat = narrow centered column; terminal = full-width).

Navigation: unified dropdown `Copilot → Chat | Terminal` in top nav.

## Terminal Architecture

```
Browser                          Container
┌──────────────────────────┐     ┌────────────────────────┐
│ xterm.js                 │     │                        │
│   ↕ WebSocket            │────▶│ Go backend (PTY bridge) │
│                          │     │   ↕ os/exec + pty      │
│                          │     │ opencode / aider / ...  │
└──────────────────────────┘     └────────────────────────┘
```

- Go backend starts agent process with `os/exec` + PTY, bridges stdin/stdout to websocket
- Terminal page allows selecting which agent binary to launch (dropdown or `/ai-terminal?agent=opencode`)
- Agent process lifecycle tied to the websocket connection (disconnect → kill)

## Multi-Agent Support

**No per-agent integration.** Any CLI tool that reads files and executes commands works.

Agent binaries are installed in the AppOS container image. AppOS does not manage or provision them.

Page provides:
- Agent selector dropdown (reads from a config list or auto-discovers installed binaries)
- Optional: preset initial prompts per agent type

## Skill Sharing

Skills live in `.agents/skills/` on the container filesystem.

All agents access the same filesystem, so skills are available automatically.

A minimal `appos-skills` CLI script provides discoverability:

```bash
appos-skills list              # name + description
appos-skills show <name>       # full SKILL.md content
```

Agents invoke it via shell commands. No agent-specific format translation needed.

## Scope

- [ ] Add `/ai-terminal` route with xterm.js + WebSocket PTY
- [ ] Add agent selector with at least `opencode` as first option
- [ ] Add `appos-skills` CLI script
- [ ] Add navigation dropdown `Copilot → Chat | Terminal`
- [ ] Process lifecycle: start agent on connect, kill on disconnect

## Out of Scope

- Agent provisioning / installation management
- Agent output parsing or structured response handling
- Per-agent configuration injection (provider keys etc.)
- Session persistence for terminal sessions
- Skill marketplace or skill format translation
