import OpenAI from 'openai';
import dotenv from 'dotenv';
import { Client as MCPClient } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { ListToolsResultSchema, CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { URL } from 'url';

dotenv.config();

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const PROVIDER_ENV = process.env.LLM_PROVIDER;
const PROVIDER = PROVIDER_ENV || (OPENROUTER_API_KEY ? 'openrouter' : (OPENAI_API_KEY ? 'openai' : ''));
if (!PROVIDER) {
  console.error('No provider configured. Set OPENAI_API_KEY or OPENROUTER_API_KEY (and optional LLM_PROVIDER).');
  process.exit(1);
}
const MODEL = process.env.OPENAI_MODEL || (PROVIDER === 'openrouter' ? 'openai/gpt-4o-mini' : 'gpt-4o-mini');
const MCP_SSE_URL = process.env.MCP_SSE_URL || 'http://127.0.0.1:4444/sse';

function createOpenAIClient() {
  if (PROVIDER === 'openrouter') {
    if (!OPENROUTER_API_KEY) {
      console.error('Missing OPENROUTER_API_KEY');
      process.exit(1);
    }
    const referer = process.env.OPENROUTER_SITE || 'http://localhost';
    const title = process.env.OPENROUTER_APP || 'MCP Test';
    return new OpenAI({
      apiKey: OPENROUTER_API_KEY,
      baseURL: 'https://openrouter.ai/api/v1',
      defaultHeaders: {
        'HTTP-Referer': referer,
        'X-Title': title
      }
    });
  }
  if (!OPENAI_API_KEY) {
    console.error('Missing OPENAI_API_KEY');
    process.exit(1);
  }
  return new OpenAI({ apiKey: OPENAI_API_KEY });
}

async function connectMcp(sseUrl) {
  const transport = new SSEClientTransport(new URL(sseUrl));
  const client = new MCPClient({ name: 'mcp-openai-test', version: '1.0.0' });
  await client.connect(transport);
  return { client, transport };
}

async function listMcpTools(mcp) {
  const res = await mcp.request({ method: 'tools/list', params: {} }, ListToolsResultSchema);
  return res.tools || [];
}

function toOpenAITools(mcpTools) {
  return (mcpTools || []).map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description || '',
      parameters: t.inputSchema || { type: 'object' }
    }
  }));
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

async function run() {
  console.log(`Using provider=${PROVIDER}, model=${MODEL}`);
  const openai = createOpenAIClient();
  const { client: mcp } = await connectMcp(MCP_SSE_URL);

  try {
    const mcpTools = await listMcpTools(mcp);
    if (!mcpTools.length) {
      console.error('No MCP tools listed. Ensure the server is running.');
      process.exit(1);
    }

    const tools = toOpenAITools(mcpTools);

    const messages = [
      // { role: 'user', content: 'Store value 11 with description "openai test", then sum between 1970-01-01T00:00:00Z and 2100-01-01T00:00:00Z.' },
      { role: 'user', content: 'Store your favorite integrate value with your favorite pet name. Then give me the sum of all values for the last 7 days. Current time is ' + new Date().toISOString() }
    ];

    let guard = 0;
    let completion = await openai.chat.completions.create({
      model: MODEL,
      messages,
      tools,
      tool_choice: 'auto'
    });

    while (guard < 5) {
      guard++;
      const msg = completion.choices?.[0]?.message;
      if (!msg) break;

      const toolCalls = msg.tool_calls || [];
      if (!toolCalls.length) {
        console.log('\n--- Final Assistant Output ---');
        if (msg.content) console.log(msg.content);
        break;
      }

      const toolMessages = [];
      for (const tc of toolCalls) {
        const name = tc.function?.name;
        const args = tc.function?.arguments ? JSON.parse(tc.function.arguments) : {};
        console.log(`> Tool requested: ${name} args=${JSON.stringify(args)}`);
        const { text } = await callMcpTool(mcp, name, args);
        toolMessages.push({
          role: 'tool',
          content: text,
          tool_call_id: tc.id
        });
      }

      messages.push({ role: 'assistant', content: msg.content || '', tool_calls: msg.tool_calls });
      messages.push(...toolMessages);

      completion = await openai.chat.completions.create({
        model: MODEL,
        messages,
        tools,
        tool_choice: 'auto'
      });
    }
  } finally {
    await mcp.close();
  }
}

run().catch((e) => {
  console.error('Run failed:', e?.response?.data || e);
  process.exit(1);
}); 