/**
 * Protocol smoke test: the real MCP handler (agents createMcpHandler + our server) answers
 * initialize and tools/list. Network calls are not made (tools are only listed).
 */

import { createMcpHandler } from "agents/mcp/server";
import { describe, expect, it } from "vitest";
import type { AppEnv } from "../src/env";
import { buildServer } from "../src/tools/server";

const env = { PUBLIC_URL: "http://localhost:8787" } as unknown as AppEnv;

async function rpc(body: unknown): Promise<unknown> {
  const handler = createMcpHandler(() => buildServer(env), { route: "/mcp" });
  const res = await handler(
    new Request("http://localhost:8787/mcp", {
      method: "POST",
      headers: {
        host: "localhost:8787", // workerd always sets Host; Node's Request needs it explicitly
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2025-06-18",
      },
      body: JSON.stringify(body),
    }),
    env,
    { waitUntil: () => {}, passThroughOnException: () => {}, props: {} } as unknown as ExecutionContext,
  );
  const text = await res.text();
  const data = text.startsWith("{") ? text : (text.split("\n").find((l) => l.startsWith("data:")) ?? "").slice(5);
  return JSON.parse(data);
}

describe("MCP protocol smoke", () => {
  it("initialize returns the server instructions", async () => {
    const res = (await rpc({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "smoke", version: "1" } },
    })) as { result: { serverInfo: { name: string }; instructions: string } };
    expect(res.result.serverInfo.name).toBe("litscout");
    expect(res.result.instructions).toMatch(/1 request every 3 seconds/);
    expect(res.result.instructions).toMatch(/alphaXiv/);
  });

  it("tools/list exposes exactly the seven tools", async () => {
    const res = (await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })) as {
      result: { tools: Array<{ name: string; description: string; inputSchema: { properties: Record<string, unknown> } }> };
    };
    const names = res.result.tools.map((t) => t.name).sort();
    expect(names).toEqual(["coauthorship", "get_author", "get_paper", "paper_links", "reviews", "search", "venue"]);
    const getPaper = res.result.tools.find((t) => t.name === "get_paper");
    expect(getPaper?.description).toMatch(/ONE call/);
    expect(Object.keys(getPaper?.inputSchema.properties ?? {})).toEqual(["ids", "full"]);
  });
});
