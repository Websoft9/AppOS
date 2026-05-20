// Package iac defines the IaC workspace domain boundary.
//
// The package owns IaC-specific workspace policy such as root boundaries,
// library import boundaries, upload limits interpretation, and text-read rules.
//
// It does not own generic local filesystem behavior; that capability belongs to
// backend/infra/filesvc.
package iac