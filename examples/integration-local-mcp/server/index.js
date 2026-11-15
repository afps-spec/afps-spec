// Minimal stdio MCP server stub for the fetch_json tool.
//
// Referenced by `source.server.entry_point` of the integration manifest. A real
// server would use an MCP SDK and bundle its dependencies into the archive; this
// stub speaks newline-delimited JSON-RPC on stdio and has no dependencies.
// The credential arrives in FETCH_JSON_API_KEY, rendered by the runtime from
// the auth method's `delivery.env` (never from `mcp_config.env`).

import { createInterface } from "node:readline";

const tools = [
  {
    name: "fetch_json",
    description: "Fetch JSON from a URL and return the parsed response.",
    inputSchema: {
      type: "object",
      properties: { url: { type: "string", description: "HTTP or HTTPS URL" } },
      required: ["url"],
    },
  },
];

async function handle({ id, method, params }) {
  switch (method) {
    case "initialize":
      return { id, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "fetch-json", version: "1.0.0" } } };
    case "tools/list":
      return { id, result: { tools } };
    case "tools/call": {
      const headers = { authorization: `Bearer ${process.env.FETCH_JSON_API_KEY ?? ""}` };
      const response = await fetch(params.arguments.url, { headers });
      const text = JSON.stringify(await response.json(), null, 2);
      return { id, result: { content: [{ type: "text", text }] } };
    }
    default:
      return id === undefined ? null : { id, error: { code: -32601, message: `unknown method: ${method}` } };
  }
}

for await (const line of createInterface({ input: process.stdin })) {
  const reply = await handle(JSON.parse(line));
  if (reply) process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...reply }) + "\n");
}
