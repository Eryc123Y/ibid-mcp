import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
await mkdir(".artifacts/tmp", { recursive: true });
process.env.TMPDIR = path.resolve(".artifacts/tmp");
// Local workerd only. No upstream request, login or deployment is made.
const worker = new Miniflare(
  convertV4MiniflareOptions({
    modules: true,
    scriptPath: "dist/worker.js",
    compatibilityDate: "2026-10-01",
    compatibilityFlags: ["nodejs_compat", "global_fetch_strictly_public"],
    kvNamespaces: ["OAUTH_KV"],
    durableObjects: {
      PAIRING_STORE: { className: "PairingStore", useSQLite: true },
      SOURCE_LIMITER: { className: "SourceLimiter", useSQLite: true },
    },
    bindings: {
      PUBLIC_URL: "https://worker.example",
      MGMT_TOKEN: "synthetic-management-token-for-local-smoke",
      CONSENT_SECRET: "synthetic-consent-secret-for-local-smoke",
    },
    outboundService: () =>
      new Response("Network disabled in smoke test", { status: 503 }),
  }),
);
try {
  const headers = {
    authorization: "Bearer synthetic-management-token-for-local-smoke",
  };
  const denied = await worker.dispatchFetch(
    "https://worker.example/admin/pair",
    { method: "POST" },
  );
  assert.equal(denied.status, 401);
  const paired = await worker.dispatchFetch(
    "https://worker.example/admin/pair",
    { method: "POST", headers },
  );
  assert.equal(paired.status, 200);
  const body = await paired.json();
  assert.match(body.code, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);
  const status = await worker.dispatchFetch(
    "https://worker.example/admin/status",
    { headers },
  );
  assert.equal(status.status, 200);
  const mcp = await worker.dispatchFetch("https://worker.example/mcp");
  assert.equal(mcp.status, 401);
  console.log(
    "Local Worker bundle smoke passed: admin, pairing Durable Object, source status and protected MCP.",
  );
} finally {
  await worker.dispose();
}
