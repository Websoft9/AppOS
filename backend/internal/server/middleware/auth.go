package middleware

import (
	"context"
	"net/http"
	"strings"

	"github.com/appos/backend/internal/config"
	"github.com/rs/zerolog/log"
)

type contextKey string

const userIDKey contextKey = "userID"

// Auth validates the JWT token from Convex
func Auth(cfg *config.Config) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Extract token from Authorization header
			authHeader := r.Header.Get("Authorization")
			if authHeader == "" {
				http.Error(w, "Missing authorization header", http.StatusUnauthorized)
				return
			}

			parts := strings.Split(authHeader, " ")
			if len(parts) != 2 || parts[0] != "Bearer" {
				http.Error(w, "Invalid authorization header format", http.StatusUnauthorized)
				return
			}

			token := parts[1]

			// TODO: Validate token with Convex
			// For now, just check if token exists
			if token == "" {
				http.Error(w, "Invalid token", http.StatusUnauthorized)
				return
			}

			// TODO: Extract user ID from validated token
			userID := "user_123" // Placeholder

			// Add user ID to context
			ctx := context.WithValue(r.Context(), userIDKey, userID)
			
			log.Debug().Str("user_id", userID).Msg("User authenticated")

			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// GetUserID extracts the user ID from context
func GetUserID(ctx context.Context) string {
	if userID, ok := ctx.Value(userIDKey).(string); ok {
		return userID
	}
	return ""
}
