/** OAuth guards the MCP endpoint; pairing is added in P1. */

import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import { createMcpHandler } from "agents/mcp/server";
import { authHandler } from "./auth/handler";
import type { AppEnv } from "./env";
import { buildServer } from "./tools/server";

export { S2RateLimiter } from "./limiter/s2-limiter";

const MCP_ROUTE = "/mcp";

const mcpApiHandler: { fetch: ExportedHandlerFetchHandler<AppEnv> } = {
  async fetch(request, env, ctx) {
    const handler = createMcpHandler(() => buildServer(env), { route: MCP_ROUTE });
    return handler(request as Request, env, ctx);
  },
};

function canonicalOrigin(publicUrl: string): string {
  const url = new URL(publicUrl);
  return `${url.protocol}//${url.host}`.toLowerCase();
}

export function createProvider(publicUrl: string): OAuthProvider<AppEnv> {
  const origin = canonicalOrigin(publicUrl);
  return new OAuthProvider<AppEnv>({
    apiRoute: MCP_ROUTE,
    apiHandler: mcpApiHandler,
    defaultHandler: authHandler,
    authorizeEndpoint: "/authorize",
    tokenEndpoint: "/token",
    clientRegistrationEndpoint: "/register",
    clientIdMetadataDocumentEnabled: true,
    resourceMetadata: {
      resource: `${origin}${MCP_ROUTE}`,
      authorization_servers: [origin],
      bearer_methods_supported: ["header"],
      resource_name: "LitScout",
    },
  });
}

let cached: { url: string; provider: OAuthProvider<AppEnv> } | undefined;

function providerFor(env: AppEnv): OAuthProvider<AppEnv> {
  if (!cached || cached.url !== env.PUBLIC_URL) {
    cached = { url: env.PUBLIC_URL, provider: createProvider(env.PUBLIC_URL) };
  }
  return cached.provider;
}

export default {
  fetch(request, env, ctx) {
    return providerFor(env).fetch(request as Request, env, ctx);
  },
} satisfies ExportedHandler<AppEnv>;
