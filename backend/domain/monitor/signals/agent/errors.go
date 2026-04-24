package agent

import "errors"

var ErrRuntimeStatusTargetMismatch = errors.New("runtime-status currently supports only server targets matching serverId")

var ErrHeartbeatTargetTypeUnsupported = errors.New("first slice only supports server heartbeat targets")

var ErrHeartbeatTargetMismatch = errors.New("targetId must match serverId for server heartbeats")

var ErrFactsTargetTypeUnsupported = errors.New("first slice only supports server facts targets")

var ErrFactsTargetMismatch = errors.New("targetId must match serverId for server facts")

var ErrFactsPayloadInvalid = errors.New("facts payload is invalid")
