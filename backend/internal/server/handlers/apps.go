package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/hibiken/asynq"
	"github.com/rs/zerolog/log"
)

type App struct {
	Name   string `json:"name"`
	Status string `json:"status"`
}

type DeployRequest struct {
	AppName string `json:"app_name"`
}

type DeployResponse struct {
	DeploymentID string `json:"deployment_id"`
	Status       string `json:"status"`
}

// ListApps returns a list of all applications
func ListApps(w http.ResponseWriter, r *http.Request) {
	// TODO: Fetch from Convex
	apps := []App{
		{Name: "wordpress", Status: "running"},
		{Name: "gitlab", Status: "stopped"},
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(apps)
}

// GetApp returns details of a specific application
func GetApp(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	
	// TODO: Fetch from Convex
	app := App{
		Name:   name,
		Status: "running",
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(app)
}

// DeployApp triggers application deployment
func DeployApp(client *asynq.Client) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req DeployRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Invalid request body", http.StatusBadRequest)
			return
		}

		if req.AppName == "" {
			http.Error(w, "app_name is required", http.StatusBadRequest)
			return
		}

		// TODO: Create Asynq task
		// task := tasks.NewDeployTask(req.AppName)
		// info, err := client.Enqueue(task)
		
		log.Info().Str("app", req.AppName).Msg("Deployment triggered")

		resp := DeployResponse{
			DeploymentID: "deploy_123", // Placeholder
			Status:       "pending",
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusAccepted)
		json.NewEncoder(w).Encode(resp)
	}
}

// DeleteApp deletes an application
func DeleteApp(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	
	// TODO: Implement deletion logic
	log.Info().Str("app", name).Msg("App deletion triggered")

	w.WriteHeader(http.StatusNoContent)
}

// GetLogs returns application logs
func GetLogs(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	
	// TODO: Fetch Docker logs
	logs := "Sample logs for " + name
	
	w.Header().Set("Content-Type", "text/plain")
	w.Write([]byte(logs))
}
