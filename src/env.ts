/** Worker bindings, vars and secrets. Secrets are optional at the type level and checked at use. */

import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import type { SourceLimiter } from "./limiter/source-limiter";

export interface AppEnv {
  readonly PAIRING_STORE: DurableObjectNamespace<
    import("./auth/pairing-store").PairingStore
  >;
  readonly MGMT_TOKEN?: string;
  readonly OAUTH_KV: KVNamespace;
  readonly SOURCE_LIMITER: DurableObjectNamespace<SourceLimiter>;
  /** Injected by OAuthProvider into the default handler. */
  readonly OAUTH_PROVIDER?: OAuthHelpers;

  readonly PUBLIC_URL: string;

  readonly CONSENT_SECRET?: string;
  readonly CORE_API_KEY?: string;
  readonly S2_API_KEY?: string;
  readonly OPENALEX_API_KEY?: string;
}
