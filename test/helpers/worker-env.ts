import type { AppEnv } from "../../src/env";
import { PairingStore } from "../../src/auth/pairing-store";
import { memoryState } from "./storage";
export function workerEnv() {
  const kv = new Map<string, string>();
  const store = new PairingStore(memoryState().state, {} as AppEnv);
  const env = {
    PUBLIC_URL: "https://worker.example",
    MGMT_TOKEN: "m".repeat(40),
    CONSENT_SECRET: "s".repeat(40),
    OAUTH_KV: {
      get: async (key: string, format?: string | { type: string }) => {
        const value = kv.get(key);
        return value === undefined
          ? null
          : (typeof format === "object" ? format.type : format) === "json"
            ? JSON.parse(value)
            : value;
      },
      put: async (key: string, value: string) => {
        kv.set(key, value);
      },
      delete: async (key: string) => {
        kv.delete(key);
      },
      list: async ({ prefix = "", cursor = "" } = {}) => ({
        keys: [...kv.keys()]
          .filter((k) => k.startsWith(prefix))
          .slice(Number(cursor))
          .map((name) => ({ name })),
        list_complete: true,
        cursor: "",
      }),
    },
    PAIRING_STORE: { idFromName: () => "owner", get: () => store },
    SOURCE_LIMITER: {
      idFromName: (source: string) => source,
      get: () => ({
        reserve: async () => ({ ok: true, waitMs: 0 }),
        recordHeaders: async () => {},
        penalize: async () => {},
        status: async () => null,
      }),
    },
  } as unknown as AppEnv;
  const ctx = {
    waitUntil: () => {},
    passThroughOnException: () => {},
  } as unknown as ExecutionContext;
  return { env, ctx, kv, store };
}
