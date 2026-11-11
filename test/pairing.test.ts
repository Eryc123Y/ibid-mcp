import { describe, expect, it, vi } from "vitest";
import { PairingStore } from "../src/auth/pairing-store";
import { constantTimeEqual } from "../src/auth/crypto";
import { authHandler } from "../src/auth/handler";
import type { AppEnv } from "../src/env";
import { memoryState } from "./helpers/storage";

function setup() {
  const { state, data } = memoryState();
  const store = new PairingStore(state, {} as AppEnv);
  const oauth = {
    parseAuthRequest: vi.fn(async () => ({ clientId: "client", scope: [] })),
    describeConsent: vi.fn(async () => ({
      clientName: "<script>",
      redirectHost: "client.example",
      scope: [],
    })),
    beginConsent: vi.fn(async () => ({
      handle: "bound",
      headers: new Headers(),
    })),
    approveConsent: vi.fn(async () => ({
      request: { clientId: "client", scope: [] },
      headers: new Headers(),
    })),
    denyConsent: vi.fn(async () => ({
      headers: new Headers({
        location: "https://client.example/?error=access_denied",
      }),
    })),
    completeAuthorization: vi.fn(async () => ({
      redirectTo: "https://client.example/callback",
    })),
    deleteClient: vi.fn(async () => {}),
  };
  const env = {
    PUBLIC_URL: "https://worker.example",
    MGMT_TOKEN: "m".repeat(32),
    CONSENT_SECRET: "c".repeat(32),
    OAUTH_PROVIDER: oauth,
    PAIRING_STORE: { idFromName: () => "pairing", get: () => store },
  } as unknown as AppEnv;
  const call = (
    path: string,
    method = "GET",
    body?: unknown,
    token = env.MGMT_TOKEN,
  ) =>
    authHandler.fetch(
      new Request(`https://worker.example${path}`, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
      }),
      env,
      {} as ExecutionContext,
    );
  return { store, data, env, oauth, call };
}
describe("PairingStore", () => {
  it("stores only a hash and consumes a code once across concurrent approvals", async () => {
    const { store, data } = setup();
    const { code } = await store.create();
    expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);
    expect(JSON.stringify([...data])).not.toContain(code);
    const results = await Promise.all([
      store.consume(code, "a"),
      store.consume(code, "b"),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });
  it("persists the five-attempt limit across object recreation and never accepts attempt six", async () => {
    const { state } = memoryState();
    const a = new PairingStore(state, {} as AppEnv);
    const { code } = await a.create();
    await Promise.all(
      Array.from({ length: 5 }, () => a.consume("WRONG", "client")),
    );
    expect(
      await new PairingStore(state, {} as AppEnv).consume(code, "client"),
    ).toBeNull();
  });
  it("expires at ten minutes and replaces earlier codes", async () => {
    vi.useFakeTimers();
    const { store } = setup();
    const first = await store.create();
    const next = await store.create();
    expect(await store.consume(first.code, "a")).toBeNull();
    vi.advanceTimersByTime(600_000);
    expect(await store.consume(next.code, "a")).toBeNull();
  });
  it("checks and revokes approved clients immediately", async () => {
    const { store } = setup();
    const { code } = await store.create();
    const approval = await store.consume(code, "client");
    expect(await store.isActive(approval!)).toBe(true);
    expect(await store.clients()).toHaveLength(1);
    await store.revoke("client");
    expect(await store.isActive(approval!)).toBe(false);
  });
  it("compares fixed digests, including unequal lengths", async () => {
    expect(await constantTimeEqual("same", "same")).toBe(true);
    expect(await constantTimeEqual("same", "different")).toBe(false);
  });
});
describe("pairing HTTP routes", () => {
  it("fails closed without management credentials; uses exact Bearer syntax", async () => {
    const { call, env } = setup();
    expect((await call("/admin/pair", "POST", undefined, "wrong")).status).toBe(
      401,
    );
    expect((await call("/admin/pair", "POST", undefined, "")).status).toBe(401);
    delete (env as { MGMT_TOKEN?: string }).MGMT_TOKEN;
    expect((await call("/admin/clients")).status).toBe(503);
  });
  it("creates, lists, revokes and reports status through authenticated admin routes", async () => {
    const { call, store, oauth } = setup();
    const p = (await (await call("/admin/pair", "POST")).json()) as {
      code: string;
    };
    await store.consume(p.code, "client");
    expect(await (await call("/admin/clients")).json()).toMatchObject({
      clients: [{ clientId: "client" }],
    });
    expect((await call("/admin/revoke", "POST", { id: "client" })).status).toBe(
      200,
    );
    expect(oauth.deleteClient).toHaveBeenCalledWith("client");
    expect(await (await call("/admin/status")).json()).toMatchObject({
      endpoint: "https://worker.example/mcp",
    });
    expect((await call("/admin/revoke", "POST", {})).status).toBe(400);
    expect((await call("/unknown")).status).toBe(404);
  });
  it("escapes the approval page and requires a signed consent configuration", async () => {
    const { call, env } = setup();
    const res = await call("/authorize");
    const html = await res.text();
    expect(html).toContain('name="code"');
    expect(html).not.toContain("<script>");
    expect(res.headers.get("cache-control")).toBe("no-store");
    delete (env as { CONSENT_SECRET?: string }).CONSENT_SECRET;
    expect((await call("/authorize")).status).toBe(503);
  });
  it("validates browser consent before consuming the code and completes OAuth", async () => {
    const { store, env, oauth } = setup();
    const { code } = await store.create();
    const req = new Request("https://worker.example/authorize", {
      method: "POST",
      body: new URLSearchParams({ handle: "bound", decision: "approve", code }),
    });
    const res = await authHandler.fetch(req, env, {} as ExecutionContext);
    expect(res.status).toBe(302);
    expect(oauth.approveConsent).toHaveBeenCalledWith(
      expect.anything(),
      "bound",
      expect.objectContaining({
        remember: { secret: env.CONSENT_SECRET, subject: "owner" },
      }),
    );
    expect(oauth.completeAuthorization).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "owner",
        props: expect.objectContaining({ authorizationId: expect.any(String) }),
      }),
    );
  });
  it("rejects invalid codes, denial and unbound consent without authorizing", async () => {
    const { store, env, oauth } = setup();
    const { code } = await store.create();
    const submit = (decision: string, code: string) =>
      authHandler.fetch(
        new Request("https://worker.example/authorize", {
          method: "POST",
          body: new URLSearchParams({ decision, code, handle: "bound" }),
        }),
        env,
        {} as ExecutionContext,
      );
    expect((await submit("approve", "WRONG")).status).toBe(403);
    expect(oauth.completeAuthorization).not.toHaveBeenCalled();
    expect((await submit("deny", code)).status).toBe(302);
    oauth.approveConsent.mockRejectedValueOnce(new Error("invalid binding"));
    expect((await submit("approve", code)).status).toBe(400);
    expect(await store.consume(code, "client")).not.toBeNull();
  });
});
