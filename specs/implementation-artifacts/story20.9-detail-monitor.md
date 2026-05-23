# Story 20.9: Server Detail Monitor Tab

**Epic**: Epic 20 - Servers
**Status**: Implemented | **Priority**: P1 | **Depends on**: Story 20.6, Story 20.7, Story 28.4, Story 28.6

## User Story

As a superuser, I can understand one server's monitoring state from a compact detail tab, so that I can see trends, read clear conclusions, and know when intervention is required.

## Direction

Use the same high-level layout model as `Systemd`, but keep monitoring infrastructure quiet unless it blocks the business view.

- header: lightweight freshness / coverage hint when monitoring works
- top banner: only for broken or not-connected monitoring
- left: latest stat, then trend history
- right: compact conclusions list + selected conclusion detail

The tab should answer:

1. can the user trust the monitor data
2. what is the server doing now
3. what changed over the selected time range
4. what conclusion needs user attention

## Interaction Contract

### Normal Monitoring State

Do not show a large `Monitoring Health` block. Show only a small hint near the title, such as active / delayed / partial.

### Left Pane

Show:

- latest resource stat cards
- trend history for CPU, memory, disk, network
- existing window switching

`Latest Stat` is a separate latest-observed surface and must not be derived from the active trend window.
It should load independently from trend history, refresh on the managed-agent cadence, and show only the most recent point per metric family.

Preferred presentation:

- CPU, Memory, Disk Usage: half-gauge cards
- Disk IO, Network Speed, Network Traffic: symmetric two-sided comparison bars
- updated-at label derived from the latest observed timestamps, not from the selected trend window label

### Right Pane

Show compact business/resource conclusions, not monitoring plumbing.

Initial chains:

- control reachability
- metrics ingest freshness
- resource pressure

Each item should be one compact row. Selecting a row shows detail below the list.

- current state
- likely reason
- operator implication

## Strong Intervention State

When monitoring is not actually connected, show a strong warning banner above the two-column content.

Trigger examples:

- Netdata agent not installed
- Netdata service unreadable or inactive
- no monitor heartbeat for the server
- metrics remain stale / missing

In this state:

- clearly state that monitoring is unavailable
- keep `Latest Stat` / `Trend History` in empty or unavailable state
- show `Conclusions` empty state, not `Agent missing`
- provide one primary action: go to `Components`

The install / repair workflow should live in `Components`, not inside `Monitor`.

## ASCII Draft

```text
+----------------------------------------------------------------------------------+
| Monitor                                            Active · updated recently      |
+----------------------------------------------------------------------------------+
|                                                                                  |
|  +--------------------------------------------------+   +---------------------+  |
|  | Latest Stat                                      |   | Conclusions         |  |
|  | CPU Gauge      32%                               |   | - Control link OK   |  |
|  | Memory Gauge   4.2 GB / 8 GB                     |   | - Agent missing      |  |
|  | Disk Gauge     71% used                          |   | - No fresh metrics   |  |
|  | Network Bars   1.2 MB/s in vs 0.8 MB/s out       |   | - User action needed |  |
|  +--------------------------------------------------+   +---------------------+  |
|                                                                                  |
|  +--------------------------------------------------+   +---------------------+  |
|  | Trend History                                     |   | Selected message    |  |
|  | [1h] [5h] [12h] [1d] [7d]                         |   | Memory pressure     |  |
|  |  _/^^\__                                          |   | Monitor is not      |  |
|  | _/     \_                                         |   | active on this      |  |
|  +--------------------------------------------------+   | server. Trends may  |  |
|                                                         | be missing or stale.|  |
|  +--------------------------------------------------+   |                     |  |
|  | Memory / Disk / Network trends                    |   | Next step: open     |  |
|  | [chart stack]                                     |   | Components and fix  |  |
|  +--------------------------------------------------+   | monitor-agent.      |  |
|                                                         +---------------------+  |
+----------------------------------------------------------------------------------+

Broken monitoring state:

+----------------------------------------------------------------------------------+
| [!] Monitoring is not connected. Install or repair from Components. [Go]          |
+----------------------------------------------------------------------------------+
| Latest Stat unavailable             | Conclusions: No conclusions yet             |
| Trend History unavailable           | Monitoring data is required for analysis.   |
+----------------------------------------------------------------------------------+
```

## Acceptance Criteria

- [x] AC1: `Monitor` uses a two-column detail-tab layout aligned with `Systemd`.
- [x] AC2: The left pane is the primary visual surface for latest resource values and trend charts.
- [x] AC3: The right pane shows message-style conclusions across multiple monitoring chains.
- [x] AC4: The tab has a strong intervention state when monitoring is not connected.
- [x] AC5: The primary recovery action from the intervention state navigates to `Components`.
- [x] AC6: `Monitor` stays focused on status comprehension, not install / repair workflow ownership.

## Implementation Note

The implemented `Latest Stat` surface is no longer a synonym for `1m` trend.
It reads from a dedicated latest-metrics endpoint, keeps its own refresh cadence aligned with the managed monitor agent, and remains visible even when the user switches trend windows.