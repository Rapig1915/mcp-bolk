# MCP SQLite Demo (Node.js + React)

A minimal MCP server (SSE transport) with SQLite storage, a small React UI, and a backend chat endpoint that orchestrates OpenAI tool-calling with MCP.

- MCP tools:
  - `store(value: integer, description: string)` → inserts a row with current timestamp
  - `sum(from: ISO datetime, to: ISO datetime)` → returns sum of values in range
- Web UI (React + Vite):
  - Paginated table of stored entries
  - Simple forms to test `store` and `sum`
  - Chat box that calls `/api/chat` (OpenAI + MCP tools)

## Requirements
- Node.js 18+ (tested on Node 22)

## Install
```bash
cd /mnt/WORK/Project/MegaVX/mcp-test
npm install
npm --workspace server install
npm --workspace web install
```

## Build and Start
- Build the web app:
```bash
npm run build
```
- Start the server (serves API, MCP SSE, and the built UI):
```bash
npm start
# Open http://localhost:4444
```

By default, the SQLite database file is created at `data.sqlite` in the project root.

## Web UI
- Visit `http://localhost:4444` to:
  - Add entries using the Store form
  - Compute sums using the Sum form
  - Ask questions in the Chat box (the backend uses MCP tools via OpenAI tool-calling)
  - Browse entries with pagination

## REST API (for the UI/tests)
- `GET /api/entries?page=<int>&pageSize=<int>` → paginated entries
- `POST /api/tools/store` with JSON body `{ "value": number, "description": string }`
- `GET /api/tools/sum?from=<ISO>&to=<ISO>` → `{ total: number }`

Example:
```bash
curl -X POST http://localhost:4444/api/tools/store \
  -H 'Content-Type: application/json' \
  -d '{"value":5,"description":"hello"}'

curl 'http://localhost:4444/api/tools/sum?from=1970-01-01T00:00:00.000Z&to=2100-01-01T00:00:00.000Z'
```

## Chat API (OpenAI + MCP tools)
- `POST /api/chat`
- Request body: either `{ "message": string }` or `{ "messages": [{ role: 'user'|'assistant'|'tool', content: string, ... }] }`
- Response (non-streaming): `{ role: 'assistant', content: string, model: string, toolLogs?: Array }`

Example:
```bash
curl -X POST http://localhost:4444/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"message":"Store value 7 called demo, then sum last 24h"}'
```

How it works:
- The server queries MCP for tools, passes them to OpenAI, and loops on `tool_calls`.
- For each tool call, the server calls MCP and feeds results back to the model.
- The final assistant message is returned as a single JSON response.

## MCP (Model Context Protocol)
- Transport: HTTP + SSE
- Connect endpoint (GET): `http://localhost:4444/sse`
- Message endpoint (POST): `http://localhost:4444/messages`
- Tools provided: `store`, `sum`

### Test with MCP Inspector (optional)
```bash
npx @modelcontextprotocol/inspector
```
- Transport: SSE
- URL: `http://localhost:4444/sse`
- Connect → Tools → List → Call `store`/`sum`

## Environment Variables
- General
  - `PORT` (default: `4444`)
  - `DB_PATH` (default: `./data.sqlite` in repo root)
- OpenAI / OpenRouter
  - `LLM_PROVIDER` = `openai` | `openrouter` (optional; auto-detected from keys)
  - `OPENAI_API_KEY` (required if provider is OpenAI)
  - `OPENAI_MODEL` (optional; default: `gpt-4o-mini` or `openai/gpt-4o-mini` on OpenRouter)
  - `OPENROUTER_API_KEY` (required if provider is OpenRouter)
  - `OPENROUTER_SITE` (optional; e.g., your site URL for OpenRouter attribution)
  - `OPENROUTER_APP` (optional; name for OpenRouter attribution)
- MCP client
  - `MCP_SSE_URL` (optional; default: `http://127.0.0.1:${PORT}/sse`)
  - `MCP_AUTH_TOKEN` (optional; enables auth protection for `/sse`)

## Authentication for MCP SSE (Production)
When `MCP_AUTH_TOKEN` is set, the `/sse` endpoint requires a token.

- Server-side enforcement:
  - Accepts `Authorization: Bearer <token>` header OR `?token=<token>` query param.
- Client connections must include the token. Examples:
  - Header:
    ```bash
    curl -H 'Authorization: Bearer YOUR_TOKEN' http://your-domain/sse
    ```
  - Query param (useful for tools that can’t set headers):
    ```bash
    curl 'http://your-domain/sse?token=YOUR_TOKEN'
    ```
- Local mode: leave `MCP_AUTH_TOKEN` unset → no auth required.

## Production Deployment
- Build and serve the UI + API + MCP SSE from the Node server, or place a reverse proxy (Nginx/Cloudflare) in front.
- Use HTTPS with a valid cert.
- Set environment variables appropriately (at minimum, `OPENAI_API_KEY` or OpenRouter vars; optionally `MCP_AUTH_TOKEN`).
- If MCP is hosted separately, set `MCP_SSE_URL` on the server so the chat endpoint connects to the public MCP.
- Keep MCP private when possible (behind auth); only the backend talks to MCP, not the browser or OpenAI directly.

### Nginx reverse proxy (SSE-friendly)
```nginx
server {
  listen 80;
  server_name your-domain;
  return 301 https://$host$request_uri;
}

server {
  listen 443 ssl http2;
  server_name your-domain;

  # ssl_certificate ...;
  # ssl_certificate_key ...;

  # API and UI
  location / {
    proxy_pass http://127.0.0.1:4444;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  # SSE endpoint (critical options)
  location /sse {
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_buffering off;
    chunked_transfer_encoding off;
    proxy_read_timeout 3600s;
    add_header Cache-Control "no-cache";
    proxy_pass http://127.0.0.1:4444/sse;
  }

  # Messages endpoint for MCP
  location /messages {
    proxy_pass http://127.0.0.1:4444/messages;
    proxy_http_version 1.1;
  }
}
```

Notes:
- Disable proxy buffering for SSE and keep long read timeouts.
- Prefer header-based auth for `/sse` (`Authorization: Bearer ...`), but query param is also supported.

## Local vs Production quick start
- Local (no auth):
  ```bash
  npm run build && npm start
  # Open http://localhost:4444
  ```
- Production (with auth + OpenAI):
  ```bash
  export PORT=4444
  export OPENAI_API_KEY=sk-...
  export OPENAI_MODEL=gpt-4o-mini
  export MCP_AUTH_TOKEN=change-me
  # Optional if MCP is separate:
  # export MCP_SSE_URL=https://mcp.example.com/sse

  npm run build && npm start
  # Behind Nginx/HTTPS
  ```

## Use with Cursor (MCP)
You can point Cursor to this MCP server via SSE.

- Start this server and ensure `/sse` is reachable (and include the token if enabled):
  - `http://localhost:4444/sse`
  - `https://your-domain/sse?token=YOUR_TOKEN` (if using query token)
- In Cursor, add a new MCP Server:
  - Transport: SSE (HTTP)
  - URL: one of the above
- Save, then list tools and try `store` and `sum`.

## Development tips
- Frontend dev server with proxy:
  - Terminal A: `npm start` (server on 4444)
  - Terminal B: `cd web && npm run dev` (Vite on 5173, proxies `/api`, `/sse`, `/messages` to 4444)
- Default page size in UI: 10 (change via query param in `/api/entries`).

## Project Structure
```
/mcp-test
  package.json
  server/
    package.json
    index.js           # Express server, SQLite, REST, MCP SSE, /api/chat
  web/
    package.json
    vite.config.js     # Proxy to server during dev
    index.html
    src/
      App.jsx
      main.jsx
      styles.css
  data.sqlite          # auto-created
```

## Stop/kill a running server (Linux)
- Identify process on port 4444:
```bash
lsof -nP -iTCP:4444 -sTCP:LISTEN
```
- Kill by PID (replace <PID>):
```bash
kill <PID>        # try graceful
kill -9 <PID>     # force if still running
```
- Or kill by script path:
```bash
pkill -f '/mnt/WORK/Project/MegaVX/mcp-test/server/index.js'
```
- Or kill by port (requires `psmisc`):
```bash
fuser -k 4444/tcp || true
```
- Verify it’s free:
```bash
lsof -nP -iTCP:4444 -sTCP:LISTEN || echo 'Port 4444 free'
```

## Testing steps

- Prereq: Node.js 18+

1. Install dependencies
```bash
cd /mnt/WORK/Project/MegaVX/mcp-test
npm install
npm --workspace server install
npm --workspace web install
```

2. Build the web app
```bash
npm run build
```

3. Start the server (serves API, MCP SSE, and the built UI)
```bash
npm start
# Open http://localhost:4444
```

4. Smoke test the REST API
```bash
# Insert a row
curl -X POST http://localhost:4444/api/tools/store \
  -H 'Content-Type: application/json' \
  -d '{"value":3,"description":"smoke"}'

# Sum over a wide time range
curl 'http://localhost:4444/api/tools/sum?from=1970-01-01T00:00:00.000Z&to=2100-01-01T00:00:00.000Z'
```

5. Test the Web UI
- Visit `http://localhost:4444`
- Add an entry via the Store form, verify it appears in the table
- Run a Sum and verify the total
- Try the Chat box with a prompt like: "Store 11 with description demo, then sum last 7 days"

6. Optional: Dev mode (hot reload for the UI)
```bash
# Terminal A
npm start  # server on 4444

# Terminal B
cd web && npm run dev  # Vite on 5173, proxies to 4444
# Open http://localhost:5173
```

7. Optional: Test MCP with Inspector
```bash
npx @modelcontextprotocol/inspector
# Transport: SSE, URL: http://localhost:4444/sse
# If auth enabled: https://your-domain/sse?token=YOUR_TOKEN
``` 