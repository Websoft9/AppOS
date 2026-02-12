package handlers

import (
	"io"
	"net/http"
	"os"
	"os/exec"

	"github.com/creack/pty"
	"github.com/gorilla/websocket"
	"github.com/rs/zerolog/log"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		// TODO: Implement proper origin check
		return true
	},
}

// Terminal handles WebSocket connections for web terminal
func Terminal(w http.ResponseWriter, r *http.Request) {
	// Upgrade to WebSocket
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Error().Err(err).Msg("Failed to upgrade WebSocket")
		return
	}
	defer conn.Close()

	// TODO: Validate auth before spawning shell
	// For now, we'll proceed

	// Start bash shell
	cmd := exec.Command("bash")
	cmd.Env = append(os.Environ(), "TERM=xterm-256color")

	// Start PTY
	ptmx, err := pty.Start(cmd)
	if err != nil {
		log.Error().Err(err).Msg("Failed to start PTY")
		return
	}
	defer func() {
		ptmx.Close()
		cmd.Process.Kill()
	}()

	// Set PTY size (can be updated via WebSocket messages)
	// pty.Setsize(ptmx, &pty.Winsize{Rows: 24, Cols: 80})

	// Copy PTY output to WebSocket (PTY → Client)
	go func() {
		buf := make([]byte, 1024)
		for {
			n, err := ptmx.Read(buf)
			if err != nil {
				if err != io.EOF {
					log.Error().Err(err).Msg("PTY read error")
				}
				return
			}

			if err := conn.WriteMessage(websocket.TextMessage, buf[:n]); err != nil {
				log.Error().Err(err).Msg("WebSocket write error")
				return
			}
		}
	}()

	// Copy WebSocket input to PTY (Client → PTY)
	for {
		_, message, err := conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Error().Err(err).Msg("WebSocket read error")
			}
			break
		}

		if _, err := ptmx.Write(message); err != nil {
			log.Error().Err(err).Msg("PTY write error")
			break
		}
	}

	log.Info().Msg("Terminal session closed")
}
