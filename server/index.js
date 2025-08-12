import express from 'express';
import cors from 'cors';
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import { Client as MCPClient } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { ListToolsResultSchema, CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 4444;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data.sqlite');

// Provider/model configuration for OpenAI/OpenRouter
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const PROVIDER_ENV = process.env.LLM_PROVIDER;
const PROVIDER = PROVIDER_ENV || (OPENROUTER_API_KEY ? 'openrouter' : (OPENAI_API_KEY ? 'openai' : ''));
const DEFAULT_MODEL = process.env.OPENAI_MODEL || (PROVIDER === 'openrouter' ? 'openai/gpt-4o-mini' : 'gpt-4o-mini');

function createOpenAIClient() {
  if (PROVIDER === 'openrouter') {
    if (!OPENROUTER_API_KEY) throw new Error('Missing OPENROUTER_API_KEY');
    const referer = process.env.OPENROUTER_SITE || 'http://localhost';
    const title = process.env.OPENROUTER_APP || 'MCP Test';
    return new OpenAI({
      apiKey: OPENROUTER_API_KEY,
      baseURL: 'https://openrouter.ai/api/v1',
      defaultHeaders: {
        'HTTP-Referer': referer,
        'X-Title': title,
      },
    });
  }
  if (!OPENAI_API_KEY) throw new Error('Missing OPENAI_API_KEY');
  return new OpenAI({ apiKey: OPENAI_API_KEY });
}

function toOpenAITools(mcpTools) {
  return (mcpTools || []).map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description || '',
      parameters: t.inputSchema || { type: 'object' },
    },
  }));
}

async function connectMcpClient(sseUrl) {
  const url = new URL(sseUrl);
  const authToken = process.env.MCP_AUTH_TOKEN;
  // If MCP_AUTH_TOKEN is set, pass it via query for compatibility
  if (authToken && !url.searchParams.has('token')) {
    url.searchParams.set('token', authToken);
  }
  const transport = new SSEClientTransport(url);
  const client = new MCPClient({ name: 'mcp-openai-backend', version: '1.0.0' });
  await client.connect(transport);
  return { client, transport };
}

async function listMcpTools(mcp) {
  const res = await mcp.request({ method: 'tools/list', params: {} }, ListToolsResultSchema);
  return res.tools || [];
}

async function callMcpTool(mcp, name, args) {
  const res = await mcp.request({ method: 'tools/call', params: { name, arguments: args || {} } }, CallToolResultSchema);
  let text = '';
  for (const c of res.content || []) {
    if (c.type === 'text' && c.text) text += c.text + '\n';
  }
  if (!text) text = JSON.stringify(res);
  return { isError: !!res.isError, text: text.trim() };
}

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

// Chat endpoint using OpenAI tool-calling against MCP
app.post('/api/chat', async (req, res) => {
  try {
    const body = req.body || {};
    let { message, messages } = body;

    if (!messages && typeof message === 'string' && message.trim()) {
      messages = [{ role: 'user', content: message.trim() }];
    }
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'Provide `message` or non-empty `messages` array.' });
    }

    const model = DEFAULT_MODEL;
    const openai = createOpenAIClient();

    // Determine MCP SSE URL: default to local server unless overridden
    const sseUrl = process.env.MCP_SSE_URL || `http://127.0.0.1:${PORT}/sse`;
    const { client: mcp } = await connectMcpClient(sseUrl);

    try {
      const mcpTools = await listMcpTools(mcp);
      if (!mcpTools.length) {
        return res.status(500).json({ error: 'No MCP tools available' });
      }
      const tools = toOpenAITools(mcpTools);

      let guard = 0;
      let completion = await openai.chat.completions.create({
        model,
        messages,
        tools,
        tool_choice: 'auto',
      });

      const toolLogs = [];

      while (guard < 5) {
        guard++;
        const msg = completion.choices?.[0]?.message;
        if (!msg) break;

        const toolCalls = msg.tool_calls || [];
        if (!toolCalls.length) {
          const finalText = msg.content || '';
          return res.json({ role: 'assistant', content: finalText, model, toolLogs });
        }

        const toolMessages = [];
        for (const tc of toolCalls) {
          const name = tc.function?.name;
          const args = tc.function?.arguments ? JSON.parse(tc.function.arguments) : {};
          const { text } = await callMcpTool(mcp, name, args);
          toolLogs.push({ name, args, output: text });
          toolMessages.push({ role: 'tool', content: text, tool_call_id: tc.id });
        }

        messages.push({ role: 'assistant', content: msg.content || '', tool_calls: msg.tool_calls });
        messages.push(...toolMessages);

        completion = await openai.chat.completions.create({
          model,
          messages,
          tools,
          tool_choice: 'auto',
        });
      }

      return res.json({ role: 'assistant', content: '(stopped after max tool iterations)', model, toolLogs });
    } finally {
      await mcp.close();
    }
  } catch (e) {
    console.error('Chat error:', e?.response?.data || e);
    return res.status(500).json({ error: 'chat_failed', detail: e?.response?.data || String(e) });
  }
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
  // Optional auth: require token via header or query when MCP_AUTH_TOKEN is set
  const requiredToken = process.env.MCP_AUTH_TOKEN;
  if (requiredToken) {
    const authHeader = req.headers['authorization'] || '';
    const queryToken = req.query.token;
    const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (bearer !== requiredToken && queryToken !== requiredToken) {
      return res.status(401).send('Unauthorized');
    }
  }

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