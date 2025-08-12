import express from 'express';
import cors from 'cors';
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 4444;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data.sqlite');

// Initialize DB
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.exec(`CREATE TABLE IF NOT EXISTS entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  value INTEGER NOT NULL,
  description TEXT NOT NULL,
  created_at TEXT NOT NULL
)`);

// Core logic shared by REST and MCP tools
function insertEntry({ value, description }) {
  const createdAt = new Date().toISOString();
  const stmt = db.prepare('INSERT INTO entries(value, description, created_at) VALUES(?, ?, ?)');
  const info = stmt.run(value, description, createdAt);
  return { id: info.lastInsertRowid, value, description, created_at: createdAt };
}

function sumEntries({ from, to }) {
  const stmt = db.prepare('SELECT COALESCE(SUM(value), 0) as total FROM entries WHERE created_at >= ? AND created_at <= ?');
  const row = stmt.get(from, to);
  return row.total || 0;
}

function listEntries({ page = 1, pageSize = 10 }) {
  const size = Math.max(1, Math.min(100, Number(pageSize)));
  const p = Math.max(1, Number(page));
  const totalRow = db.prepare('SELECT COUNT(1) as c FROM entries').get();
  const total = totalRow.c;
  const pages = Math.max(1, Math.ceil(total / size));
  const offset = (p - 1) * size;
  const rows = db.prepare('SELECT * FROM entries ORDER BY created_at DESC LIMIT ? OFFSET ?').all(size, offset);
  return { items: rows, page: p, pageSize: size, total, pages };
}

// Express app
const app = express();
app.use(cors());
app.use(express.json());

// REST endpoints for UI
app.get('/api/entries', (req, res) => {
  const { page, pageSize } = req.query;
  const result = listEntries({ page: Number(page) || 1, pageSize: Number(pageSize) || 10 });
  res.json(result);
});

app.post('/api/tools/store', (req, res) => {
  const { value, description } = req.body || {};
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return res.status(400).json({ error: 'value must be an integer' });
  }
  if (typeof description !== 'string' || !description.trim()) {
    return res.status(400).json({ error: 'description is required' });
  }
  const entry = insertEntry({ value, description });
  res.json(entry);
});

app.get('/api/tools/sum', (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) {
    return res.status(400).json({ error: 'from and to query params are required (ISO datetime)' });
  }
  const total = sumEntries({ from: String(from), to: String(to) });
  res.json({ total });
});

// MCP server via SSE
const server = new Server({ name: 'mcp-sqlite-server', version: '1.0.0' }, { capabilities: { tools: {} } });

// Define tools via request handlers
const toolsList = [
  {
    name: 'store',
    description: 'Store an integer value with description and timestamp',
    inputSchema: {
      type: 'object',
      properties: {
        value: { type: 'integer' },
        description: { type: 'string' }
      },
      required: ['value', 'description']
    }
  },
  {
    name: 'sum',
    description: 'Sum values between ISO datetime range [from, to]',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'string' },
        to: { type: 'string' }
      },
      required: ['from', 'to']
    }
  }
];

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: toolsList };
});

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params || {};
  if (name === 'store') {
    const { value, description } = args || {};
    if (typeof value !== 'number' || !Number.isInteger(value)) {
      return { content: [{ type: 'text', text: 'value must be integer' }], isError: true };
    }
    if (typeof description !== 'string' || !description.trim()) {
      return { content: [{ type: 'text', text: 'description is required' }], isError: true };
    }
    const entry = insertEntry({ value, description });
    return { content: [{ type: 'text', text: JSON.stringify(entry) }] };
  }
  if (name === 'sum') {
    const { from, to } = args || {};
    if (!from || !to) {
      return { content: [{ type: 'text', text: 'from and to are required (ISO datetime)' }], isError: true };
    }
    const total = sumEntries({ from, to });
    return { content: [{ type: 'text', text: String(total) }] };
  }
  return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
});

const transports = new Map();
const POST_ENDPOINT = '/messages';

app.post(POST_ENDPOINT, async (req, res) => {
  console.log('POST /messages body:', JSON.stringify(req.body));
  const sessionId = req.query.sessionId;
  if (typeof sessionId !== 'string') {
    return res.status(400).json({ error: 'Bad session id' });
  }
  const transport = transports.get(sessionId);
  if (!transport) {
    return res.status(400).json({ error: 'No transport for sessionId' });
  }
  await transport.handlePostMessage(req, res, req.body);
});

app.get('/sse', async (req, res) => {
  const transport = new SSEServerTransport(POST_ENDPOINT, res);
  transports.set(transport.sessionId, transport);
  res.on('close', () => {
    transports.delete(transport.sessionId);
  });
  await server.connect(transport);
});

// Static file serving for built web app
const publicDir = path.join(__dirname, '..', 'web', 'dist');
app.use(express.static(publicDir));
app.get('*', (req, res) => {
  // Only fall back to index.html if file not found and not an API/MCP endpoint
  if (req.path.startsWith('/api') || req.path === '/sse' || req.path === '/messages') {
    return res.status(404).send('Not Found');
  }
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`MCP SSE endpoint: GET http://localhost:${PORT}/sse, POST http://localhost:${PORT}${POST_ENDPOINT}`);
}); 