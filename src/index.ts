/** OAuth guards the MCP endpoint; pairing is added in P1. */

import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import { createMcpHandler } from "agents/mcp/server";
import { pairingStore } from "./auth/pairing-store";
import { authHandler } from "./auth/handler";
import type { AppEnv } from "./env";
import { buildServer } from "./tools/server";

export { PairingStore } from "./auth/pairing-store";
export { SourceLimiter } from "./limiter/source-limiter";

const MCP_ROUTE = "/mcp";

const mcpApiHandler: { fetch: ExportedHandlerFetchHandler<AppEnv> } = {
  async fetch(request, env, ctx) {
    const authorizationId = (ctx as ExecutionContext & { props?: { authorizationId?: string } }).props?.authorizationId;
    if (!authorizationId || !(await pairingStore(env).isActive(authorizationId))) return new Response("Forbidden", { status: 403 });
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
