package model

import "time"

type AppInstanceProjection struct {
	LifecycleState     AppLifecycleState
	HealthSummary      HealthSummary
	PublicationSummary PublicationSummary
	DesiredState       DesiredAppState
	StateReason        string
	LastOperationID    string
	CurrentReleaseID   string
	PrimaryExposureID  string
	InstalledAt        *time.Time
	LastHealthyAt      *time.Time
	RetiredAt          *time.Time
}
