import { Client as Anthropic } from '@anthropic-ai/sdk';
import { Client as MCPClient } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { URL } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.CLAUDE_MODEL || 'claude-3-5-sonnet-20241022';
const MCP_SSE_URL = process.env.MCP_SSE_URL || 'http://127.0.0.1:4444/sse';

if (!ANTHROPIC_API_KEY) {
  console.error('Missing ANTHROPIC_API_KEY in environment');
  process.exit(1);
}

async function connectMcp(sseUrl) {
  const transport = new SSEClientTransport(new URL(sseUrl));
  const client = new MCPClient({ name: 'mcp-test-client', version: '1.0.0' });
  await client.connect(transport);
  return { client, transport };
}

async function listMcpTools(mcp) {
  const res = await mcp.request({ method: 'tools/list', params: {} });
  return res.tools || [];
}

function toAnthropicTools(mcpTools) {
  return (mcpTools || []).map((t) => ({
    name: t.name,
    description: t.description || '',
    input_schema: t.inputSchema || { type: 'object' }
  }));
}

async function callMcpTool(mcp, name, args) {
  const res = await mcp.request({ method: 'tools/call', params: { name, arguments: args || {} } });
  // Convert MCP content to a plain string summary for the model
  let text = '';
  for (const c of res.content || []) {
    if (c.type === 'text' && c.text) text += c.text + '\n';
  }
  if (!text) text = JSON.stringify(res);
  return { isError: !!res.isError, text: text.trim() };
}

async function run() {
  const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  const { client: mcp, transport } = await connectMcp(MCP_SSE_URL);

  try {
    const mcpTools = await listMcpTools(mcp);
    if (!mcpTools.length) {
      console.error('No MCP tools listed. Ensure the server is running and exposes tools.');
      process.exit(1);
    }

    const tools = toAnthropicTools(mcpTools);

    const messages = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Store value 7 with description "from script", then return the sum from 1970-01-01T00:00:00Z to 2100-01-01T00:00:00Z.' }
        ]
      }
    ];

    let loopGuard = 0;
    let response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1024,
      tools,
      messages
    });

    while (loopGuard < 5) {
      loopGuard++;
      const toolUses = (response.content || []).filter((b) => b.type === 'tool_use');
      if (!toolUses.length) break;

      const toolResults = [];
      for (const tu of toolUses) {
        console.log(`> Model requested tool: ${tu.name} args=${JSON.stringify(tu.input)}`);
        const result = await callMcpTool(mcp, tu.name, tu.input);
        console.log(`  Result (isError=${result.isError}): ${result.text}`);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: [{ type: 'text', text: result.text }]
        });
      }

      messages.push({ role: 'assistant', content: response.content });
      messages.push({ role: 'tool', content: toolResults });

      response = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 1024,
        tools,
        messages
      });
    }

    // Print final assistant text
    let finalText = '';
    for (const c of response.content || []) {
      if (c.type === 'text') finalText += c.text + '\n';
    }
    console.log('\n--- Final Assistant Output ---');
    console.log(finalText.trim());
  } finally {
    await mcp.close();
    // transport closed via client.close()
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
}); 