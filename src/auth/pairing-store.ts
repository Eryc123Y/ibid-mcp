import { DurableObject } from "cloudflare:workers";
import type { AppEnv } from "../env";
import { constantTimeEqual, digest, pairingCode } from "./crypto";
interface PairingState {
  hash: string;
  expiresAt: number;
  attempts: number;
}
export interface ApprovedClient {
  clientId: string;
  authorizationId: string;
  approvedAt: number;
}
/** Durable storage transactions serialize all code checks, including after eviction. */
export class PairingStore extends DurableObject<AppEnv> {
  async create(): Promise<{ code: string; expiresAt: number }> {
    const code = pairingCode();
    const expiresAt = Date.now() + 600_000;
    await this.ctx.storage.put("pairing", {
      hash: await digest(code),
      expiresAt,
      attempts: 0,
    });
    return { code, expiresAt };
  }
  async consume(code: string, clientId: string): Promise<string | null> {
    const hash = await digest(code.trim().toUpperCase());
    return this.ctx.storage.transaction(async (txn) => {
      const state = await txn.get<PairingState>("pairing");
      if (!state || state.expiresAt <= Date.now() || state.attempts >= 5)
        return null;
      if (!(await constantTimeEqual(hash, state.hash))) {
        await txn.put("pairing", { ...state, attempts: state.attempts + 1 });
        return null;
      }
      await txn.delete("pairing");
      const authorizationId = crypto.randomUUID();
      const clients = (await txn.get<ApprovedClient[]>("clients")) ?? [];
      await txn.put("clients", [
        ...clients,
        { clientId, authorizationId, approvedAt: Date.now() },
      ]);
      return authorizationId;
    });
  }
  async clients(): Promise<ApprovedClient[]> {
    return (await this.ctx.storage.get<ApprovedClient[]>("clients")) ?? [];
  }
  async isActive(authorizationId: string): Promise<boolean> {
    return (await this.clients()).some(
      (client) => client.authorizationId === authorizationId,
    );
  }
  async revoke(clientId: string): Promise<void> {
    await this.ctx.storage.transaction(async (txn) => {
      const clients = (await txn.get<ApprovedClient[]>("clients")) ?? [];
      await txn.put(
        "clients",
        clients.filter((client) => client.clientId !== clientId),
      );
    });
  }
}
export function pairingStore(env: AppEnv): DurableObjectStub<PairingStore> {
  return env.PAIRING_STORE.get(env.PAIRING_STORE.idFromName("owner"));
}
