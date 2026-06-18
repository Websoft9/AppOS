// Package remoteruntime is the execution-layer anchor for remote runtime egress.
//
// This slice is intentionally separate from remote shell because runtime
// actions have different defaults, risks, and rollout semantics.
package remoteruntime