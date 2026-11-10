import type { AppEnv } from "../env";
/** Fail closed until pairing is installed. */
export const authHandler = { fetch: async () => new Response("Pairing not configured", { status: 503 }) } satisfies ExportedHandler<AppEnv>;
