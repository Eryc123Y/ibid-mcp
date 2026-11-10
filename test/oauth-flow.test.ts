import { expect, it } from "vitest";
import worker from "../src/index";
import { workerEnv } from "./helpers/worker-env";
const parseCookie = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
it("completes registration, browser-bound pairing, PKCE token exchange, MCP and immediate revocation", async () => {
  const { env, ctx } = workerEnv();
  const call = (path: string, init?: RequestInit) =>
    worker.fetch(
      new Request(`https://worker.example${path}`, init) as never,
      env,
      ctx,
    );
  expect((await call("/mcp")).status).toBe(401);
  const registration = await call("/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "Test client",
      redirect_uris: ["https://client.example/callback"],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  });
  expect(registration.status).toBe(201);
  const { client_id } = (await registration.json()) as { client_id: string };
  const verifier = "v".repeat(64);
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  const challenge = Buffer.from(hash).toString("base64url");
  const qs = new URLSearchParams({
    client_id,
    redirect_uri: "https://client.example/callback",
    response_type: "code",
    state: "test-state",
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource: "https://worker.example/mcp",
  });
  const consent = await call(`/authorize?${qs}`);
  expect(consent.status).toBe(200);
  const html = await consent.text();
  const handle = html.match(/name="handle" value="([^"]+)"/)?.[1];
  expect(handle).toBeTruthy();
  const adminHeaders = { authorization: `Bearer ${env.MGMT_TOKEN}` };
  const pair = await call("/admin/pair", {
    method: "POST",
    headers: adminHeaders,
  });
  const { code } = (await pair.json()) as { code: string };
  const approved = await call("/authorize", {
    method: "POST",
    headers: { cookie: parseCookie(consent), origin: "https://worker.example" },
    body: new URLSearchParams({ handle: handle!, decision: "approve", code }),
  });
  expect(approved.status).toBe(302);
  const redirect = new URL(approved.headers.get("location")!);
  expect(redirect.searchParams.get("state")).toBe("test-state");
  const token = await call("/token", {
    method: "POST",
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id,
      redirect_uri: "https://client.example/callback",
      code: redirect.searchParams.get("code")!,
      code_verifier: verifier,
      resource: "https://worker.example/mcp",
    }),
  });
  expect(token.status).toBe(200);
  const { access_token } = (await token.json()) as { access_token: string };
  expect(access_token).toBeTruthy();
  const mcp = () =>
    call("/mcp", {
      method: "POST",
      headers: {
        authorization: `Bearer ${access_token}`,
        host: "worker.example",
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: {},
      }),
    });
  const response = await mcp();
  expect(response.status).toBe(200);
  expect(await response.text()).toContain("reviews");
  const revoked = await call("/admin/revoke", {
    method: "POST",
    headers: { ...adminHeaders, "content-type": "application/json" },
    body: JSON.stringify({ id: client_id }),
  });
  expect(revoked.status).toBe(200);
  expect([401, 403]).toContain((await mcp()).status);
});
