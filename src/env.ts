/** Worker bindings, vars and secrets. Secrets are optional at the type level and checked at use. */

import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import type { S2RateLimiter } from "./limiter/s2-limiter";

export interface AppEnv {
  readonly OAUTH_KV: KVNamespace;
  readonly S2_LIMITER: DurableObjectNamespace<S2RateLimiter>;
  /** Injected by OAuthProvider into the default handler. */
  readonly OAUTH_PROVIDER?: OAuthHelpers;

  readonly PUBLIC_URL: string;

  readonly CONSENT_SECRET?: string;
  readonly S2_API_KEY?: string;
  readonly OPENALEX_API_KEY?: string;
}

