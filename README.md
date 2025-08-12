# MCP SQLite Demo (Node.js + React)

A minimal MCP server (SSE transport) with SQLite storage and a small React UI.

- MCP tools:
  - `store(value: integer, description: string)` → inserts a row with current timestamp
  - `sum(from: ISO datetime, to: ISO datetime)` → returns sum of values in range
- Web UI (React + Vite):
  - Paginated table of stored entries
  - Simple forms to test `store` and `sum`

## Requirements
- Node.js 18+ (tested on Node 22)

## Install
```bash
cd /mnt/WORK/Project/MegaVX/mcp-bolk
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

## Use with Cursor (MCP)
You can point Cursor to this local MCP server via SSE.

- Start this server locally (`npm start`), confirm `http://localhost:4444/sse` loads.
- In Cursor, open Settings and find the MCP / Tools integration UI.
- Add a new MCP Server:
  - Transport: SSE (HTTP)
  - URL: `http://localhost:4444/sse`
- Save, then in the Cursor tools palette, list tools and try `store` and `sum`.

If Cursor supports a JSON-based MCP config, it will be similar to:
```json
{
  "servers": {
    "sqlite-demo": {
      "transport": "sse",
      "url": "http://localhost:4444/sse"
    }
  }
}
```
(Exact location/format may vary by Cursor version; use the in-app MCP settings if available.)

## Development tips
- Frontend dev server with proxy:
  - Terminal A: `npm start` (server on 4444)
  - Terminal B: `cd web && npm run dev` (Vite on 5173, proxies `/api`, `/sse`, `/messages` to 4444)
- Default page size in UI: 10 (change via query param in `/api/entries`).

## Project Structure
```
/mcp-bolk
  package.json
  server/
    package.json
    index.js           # Express server, SQLite, REST, MCP SSE
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

## Notes
- Port `4444` must be free to start the server.
- Database WAL/SHM files (`data.sqlite-wal`, `data.sqlite-shm`) are created automatically by SQLite. 

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
pkill -f '/mnt/WORK/Project/MegaVX/mcp-bolk/server/index.js'
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
cd /mnt/WORK/Project/MegaVX/mcp-bolk
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
``` 