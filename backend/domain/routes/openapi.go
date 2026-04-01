package routes

import (
	_ "embed"
	"net/http"

	"github.com/pocketbase/pocketbase/core"
	openapidocs "github.com/websoft9/appos/backend/docs/openapi"
)

// swaggerUIHTML is the Swagger UI page. It loads the UI assets from the
// official CDN and points at /openapi/spec for the embedded spec file.
// No npm build step or binary bloat — just the YAML is embedded.
const swaggerUIHTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>AppOS API Docs</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
	<style>
		body { margin: 0; }
		.auth-panel {
			display: flex;
			align-items: center;
			gap: 8px;
			padding: 10px 12px;
			border-bottom: 1px solid #e5e7eb;
			background: #fff;
			position: sticky;
			top: 0;
			z-index: 10;
			flex-wrap: wrap;
		}
		.auth-panel input,
		.auth-panel select,
		.auth-panel button {
			height: 32px;
			font-size: 13px;
			padding: 0 8px;
			border: 1px solid #d1d5db;
			border-radius: 6px;
		}
		.auth-panel button { cursor: pointer; }
		.auth-panel .primary {
			background: #2563eb;
			color: #fff;
			border-color: #2563eb;
		}
		.auth-status {
			font-size: 12px;
			color: #374151;
			margin-left: 4px;
			min-height: 16px;
		}
		.auth-status.err { color: #dc2626; }
	</style>
</head>
<body>
	<div class="auth-panel">
		<strong>Auth</strong>
		<select id="auth-collection">
			<option value="_superusers">Superuser</option>
			<option value="users">User</option>
		</select>
		<input id="auth-identity" type="text" placeholder="Email / Username" autocomplete="username" />
		<input id="auth-password" type="password" placeholder="Password" autocomplete="current-password" />
		<button id="auth-login" class="primary">Login</button>
		<button id="auth-sync">Sync Authorize</button>
		<button id="auth-logout">Logout</button>
		<span id="auth-token" class="auth-status"></span>
		<span id="auth-status" class="auth-status"></span>
	</div>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
		const TOKEN_KEY = "appos.openapi.bearerToken";

		const identityEl = document.getElementById("auth-identity");
		const passwordEl = document.getElementById("auth-password");
		const loginBtn = document.getElementById("auth-login");
		const syncBtn = document.getElementById("auth-sync");
		const logoutBtn = document.getElementById("auth-logout");
		const tokenEl = document.getElementById("auth-token");
		const statusEl = document.getElementById("auth-status");

		function setStatus(message, isError = false) {
			statusEl.textContent = message || "";
			statusEl.classList.toggle("err", !!isError);
		}

		function maskToken(token) {
			if (!token) return "No token";
			if (token.length <= 12) return "Token: " + token;
			return "Token: " + token.slice(0, 8) + "..." + token.slice(-6);
		}

		function updateTokenHint(token) {
			tokenEl.textContent = maskToken(token);
		}

		const ui = SwaggerUIBundle({
      url: "/openapi/spec",
      dom_id: "#swagger-ui",
      presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset],
      layout: "BaseLayout",
      deepLinking: true,
			docExpansion: "none",
			defaultModelsExpandDepth: -1,
			defaultModelExpandDepth: 1,
			persistAuthorization: true,
    });

		function applyToken(token) {
			if (!token) return;
			try {
				ui.preauthorizeApiKey("bearerAuth", token);
			} catch (_) {}
			updateTokenHint(token);
		}

		function clearToken() {
			localStorage.removeItem(TOKEN_KEY);
			try {
				ui.authActions.logout(["bearerAuth"]);
			} catch (_) {}
			updateTokenHint("");
		}

		const savedToken = localStorage.getItem(TOKEN_KEY);
		if (savedToken) {
			applyToken(savedToken);
			setStatus("Token restored");
		} else {
			updateTokenHint("");
		}

		loginBtn.addEventListener("click", async () => {
			const collection = document.getElementById("auth-collection").value;
			const identity = (identityEl.value || "").trim();
			const password = passwordEl.value || "";

			if (!identity || !password) {
				setStatus("Identity and password are required", true);
				return;
			}

			loginBtn.disabled = true;
			setStatus("Logging in...");

			try {
				const res = await fetch("/api/collections/" + collection + "/auth-with-password", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ identity, password }),
				});

				const data = await res.json().catch(() => ({}));
				if (!res.ok || !data.token) {
					const msg = data?.message || data?.data?.message || ("Login failed (" + res.status + ")");
					throw new Error(msg);
				}

				localStorage.setItem(TOKEN_KEY, data.token);
				applyToken(data.token);
				setStatus("Login successful. API unlocked.");
				passwordEl.value = "";
			} catch (err) {
				setStatus(err?.message || "Login failed", true);
			} finally {
				loginBtn.disabled = false;
			}
		});

		logoutBtn.addEventListener("click", () => {
			clearToken();
			setStatus("Logged out");
		});

		syncBtn.addEventListener("click", () => {
			const token = localStorage.getItem(TOKEN_KEY);
			if (!token) {
				setStatus("No token to sync", true);
				updateTokenHint("");
				return;
			}
			applyToken(token);
			setStatus("Token synced to Authorize");
		});
  </script>
</body>
</html>`

// registerOpenAPIRoutes mounts the Swagger UI and spec at /openapi.
//
//	GET /openapi      — Swagger UI (HTML, loads assets from CDN)
//	GET /openapi/spec — raw OpenAPI 3.0 YAML (embedded in binary)
//
// Both routes are public (no auth required) so tooling and CI can access
// the spec without a token.
func registerOpenAPIRoutes(se *core.ServeEvent) {
	se.Router.GET("/openapi", func(e *core.RequestEvent) error {
		e.Response.Header().Set("Content-Type", "text/html; charset=utf-8")
		e.Response.WriteHeader(http.StatusOK)
		_, _ = e.Response.Write([]byte(swaggerUIHTML))
		return nil
	})

	se.Router.GET("/openapi/spec", func(e *core.RequestEvent) error {
		e.Response.Header().Set("Content-Type", "application/yaml; charset=utf-8")
		e.Response.Header().Set("Access-Control-Allow-Origin", "*")
		e.Response.WriteHeader(http.StatusOK)
		_, _ = e.Response.Write(openapidocs.APISpec)
		return nil
	})
}
