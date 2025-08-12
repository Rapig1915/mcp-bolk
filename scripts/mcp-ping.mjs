import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { ListToolsResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { URL } from 'url';

const MCP_SSE_URL = process.env.MCP_SSE_URL || 'http://127.0.0.1:4444/sse';

async function run() {
  console.log('Connecting to', MCP_SSE_URL);
  const transport = new SSEClientTransport(new URL(MCP_SSE_URL));
  const client = new Client({ name: 'mcp-ping', version: '1.0.0' });
  await client.connect(transport);
  const tools = await client.request({ method: 'tools/list', params: {} }, ListToolsResultSchema);
  console.log('Tools:', JSON.stringify(tools, null, 2));
  await client.close();
}

run().catch((e) => { console.error('mcp-ping failed:', e); process.exit(1); }); 