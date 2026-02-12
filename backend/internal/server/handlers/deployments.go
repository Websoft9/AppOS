package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
)

type Deployment struct {
	ID       string `json:"id"`
	AppName  string `json:"app_name"`
	Status   string `json:"status"`
	CreateAt string `json:"created_at"`
}

// ListDeployments returns a list of all deployments
func ListDeployments(w http.ResponseWriter, r *http.Request) {
	// TODO: Fetch from Convex
	deployments := []Deployment{
		{ID: "deploy_123", AppName: "wordpress", Status: "success", CreateAt: "2026-02-12T10:00:00Z"},
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(deployments)
}

// GetDeployment returns details of a specific deployment
func GetDeployment(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	
	// TODO: Fetch from Convex
	deployment := Deployment{
		ID:       id,
		AppName:  "wordpress",
		Status:   "success",
		CreateAt: "2026-02-12T10:00:00Z",
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(deployment)
}

// GetTaskStatus returns the status of an Asynq task
func GetTaskStatus(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	
	// TODO: Query Asynq task status
	status := map[string]string{
		"id":     id,
		"status": "completed",
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(status)
}
