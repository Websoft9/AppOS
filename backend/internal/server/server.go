package server

import (
	"context"
	"net/http"
	"time"

	"github.com/appos/backend/internal/config"
	"github.com/appos/backend/internal/server/handlers"
	"github.com/appos/backend/internal/server/middleware"
	"github.com/go-chi/chi/v5"
	chimiddleware "github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/hibiken/asynq"
	"github.com/rs/zerolog/log"
)

type Server struct {
	cfg          *config.Config
	router       chi.Router
	httpServer   *http.Server
	asynqClient  *asynq.Client
	asynqServer  *asynq.Server
}

func New(cfg *config.Config) (*Server, error) {
	// Create Asynq client
	asynqClient := asynq.NewClient(asynq.RedisClientOpt{
		Addr: cfg.RedisAddr,
	})

	// Create Asynq server (worker)
	asynqServer := asynq.NewServer(
		asynq.RedisClientOpt{Addr: cfg.RedisAddr},
		asynq.Config{
			Concurrency: 10,
			Queues: map[string]int{
				"critical": 6,
				"default":  3,
				"low":      1,
			},
		},
	)

	s := &Server{
		cfg:         cfg,
		asynqClient: asynqClient,
		asynqServer: asynqServer,
	}

	s.setupRouter()

	return s, nil
}

func (s *Server) setupRouter() {
	r := chi.NewRouter()

	// Middleware
	r.Use(chimiddleware.RequestID)
	r.Use(chimiddleware.RealIP)
	r.Use(middleware.Logger)
	r.Use(chimiddleware.Recoverer)
	r.Use(chimiddleware.Timeout(60 * time.Second))

	// CORS
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   s.cfg.CORSAllowedOrigins,
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-Request-ID"},
		ExposedHeaders:   []string{"Link"},
		AllowCredentials: true,
		MaxAge:           300,
	}))

	// Health checks
	r.Get("/health", handlers.Health)
	r.Get("/ready", handlers.Ready)

	// API routes
	r.Route("/v1", func(r chi.Router) {
		// Auth middleware (validates Convex token)
		r.Use(middleware.Auth(s.cfg))

		// Apps
		r.Route("/apps", func(r chi.Router) {
			r.Get("/", handlers.ListApps)
			r.Post("/deploy", handlers.DeployApp(s.asynqClient))
			r.Get("/{name}", handlers.GetApp)
			r.Delete("/{name}", handlers.DeleteApp)
			r.Get("/{name}/logs", handlers.GetLogs)
		})

		// Deployments
		r.Route("/deployments", func(r chi.Router) {
			r.Get("/", handlers.ListDeployments)
			r.Get("/{id}", handlers.GetDeployment)
		})

		// Tasks
		r.Route("/tasks", func(r chi.Router) {
			r.Get("/{id}", handlers.GetTaskStatus)
		})
	})

	// Terminal WebSocket (separate, may need different auth)
	r.Get("/terminal", handlers.Terminal)

	s.router = r
}

func (s *Server) Start(addr string) error {
	s.httpServer = &http.Server{
		Addr:         addr,
		Handler:      s.router,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	// Start Asynq worker in goroutine
	go func() {
		mux := asynq.NewServeMux()
		// Register task handlers here
		// mux.HandleFunc(tasks.TypeDeployApp, tasks.HandleDeployApp)
		
		log.Info().Msg("Starting Asynq worker")
		if err := s.asynqServer.Run(mux); err != nil {
			log.Error().Err(err).Msg("Asynq server error")
		}
	}()

	return s.httpServer.ListenAndServe()
}

func (s *Server) Shutdown(ctx context.Context) error {
	log.Info().Msg("Shutting down HTTP server")
	if err := s.httpServer.Shutdown(ctx); err != nil {
		return err
	}

	log.Info().Msg("Shutting down Asynq server")
	s.asynqServer.Shutdown()

	log.Info().Msg("Closing Asynq client")
	if err := s.asynqClient.Close(); err != nil {
		return err
	}

	return nil
}
