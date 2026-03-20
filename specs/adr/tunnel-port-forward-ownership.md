# Tunnel Port Forward Ownership & Module Boundary

## Status
Accepted

## Context
AppOS currently supports reverse SSH tunnel access for servers behind NAT. The current MVP allocates stable internal ports for SSH and HTTP and exposes them through the Tunnel module.

As the product evolves, one tunnel server may need to forward more local ports or services into AppOS, such as additional HTTP services, admin ports, databases, or custom TCP endpoints.

The design question is whether this capability belongs to the generic Server module or to the Tunnel module.

## Decision

### Ownership

Advanced port forwarding is owned by the Tunnel module.

The Server module remains the system of record for the server resource itself:

- identity and metadata
- connection type selection
- credential linkage
- grouping and labeling

The Tunnel module owns all transport-specific forwarding behavior:

- forward rule definitions
- tunnel-side external port allocation
- current effective forwarded services
- reconnect and rebind behavior
- setup command and service generation
- operator actions and tunnel session state

### Architectural Rule

`server` answers: "what machine is this?"

`tunnel` answers: "how are this machine's local services exposed into AppOS?"

Therefore, multi-port forwarding must not become a generic first-class capability of all servers.

### Data Model Direction

The `servers` collection should keep only the minimum tunnel attachment information required by all modules:

- `connect_type = tunnel`
- current tunnel session state fields
- current effective `tunnel_services`

Desired forwarding intent should be modeled as Tunnel-owned configuration, not as generic Server fields.

Recommended direction:

- keep current `tunnel_services` as runtime/effective state
- add Tunnel-owned desired forwarding configuration for future expansion
- allow the Server UI to surface a Tunnel settings entry, but not own the forward-rule model

### UI Boundary

Server UI may expose:

- whether the server uses direct SSH or tunnel
- a link or embedded section for Tunnel settings

Tunnel UI owns:

- desired forwards
- current effective forwards
- setup/regeneration actions
- tunnel diagnostics and session details

## Rationale

### Why not Server-owned

If forwarding rules are modeled as a core Server capability, the Server module becomes coupled to tunnel-specific control-plane behavior that only applies to `connect_type = tunnel`.

That would:

- pollute the generic server model
- complicate direct-SSH server semantics
- blur module boundaries between resource identity and transport orchestration
- make future tunnel evolution harder

### Why Tunnel-owned

Forward rules directly affect:

- how the reverse SSH command is generated
- how ports are allocated and reserved
- what reconnect must restore
- what the operator sees in the tunnel operations view

These are all Tunnel concerns, not generic Server concerns.

## Consequences

### Positive

- cleaner module boundaries
- simpler Server model
- easier support for tunnel-only features such as multi-forward policies and dynamic rebind behavior
- clearer future relationship with Monitor, where Monitor consumes tunnel state but does not own it

### Tradeoffs

- Server detail pages may need to link into Tunnel-owned configuration rather than edit all fields inline
- some Tunnel concepts will appear adjacent to Server UI, but remain owned by Tunnel internally

## Implementation Guidance

### Phase 1

Support desired forward definitions as Tunnel configuration and apply them on reconnect or setup regeneration.

This phase should prefer static configuration plus reconnect-to-apply, rather than dynamic in-session reconfiguration.

### Phase 2

Consider live forward reconfiguration only if there is proven operator demand. This is explicitly lower priority than making desired and effective state visible and reliable.

## Scope Guardrails

This decision does not require introducing a separate Tunnel collection immediately.

The first implementation may still persist Tunnel-owned configuration on the server record if needed for delivery speed, but the ownership remains Tunnel-domain ownership, not Server-domain ownership.

In other words: storage location may be pragmatic; domain ownership is not negotiable.