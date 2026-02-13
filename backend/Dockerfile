# Build stage
FROM golang:1.26-alpine AS builder

WORKDIR /app

# Install build dependencies
RUN apk add --no-cache git

# Copy go mod files
COPY go.mod go.sum ./
RUN go mod download

# Copy source code
COPY . .

# Build binary (PocketBase framework with custom extensions)
RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o appos cmd/appos/main.go

# Runtime stage
FROM alpine:latest

RUN apk --no-cache add ca-certificates bash

WORKDIR /app

# Copy binary from builder
COPY --from=builder /app/appos .

# PocketBase data directory
VOLUME ["/app/pb_data"]

# PocketBase default port
EXPOSE 8090

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8090/api/health || exit 1

# Start PocketBase in serve mode
CMD ["./appos", "serve", "--http=0.0.0.0:8090"]
