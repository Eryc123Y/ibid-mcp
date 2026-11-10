/** Route-based fetch mock that records every call. */

export interface Route {
  readonly match: (url: URL, init: RequestInit | undefined) => boolean;
  readonly respond: (url: URL, init: RequestInit | undefined) => Response | Promise<Response>;
}

export interface MockFetch {
  readonly fetch: typeof fetch;
  readonly calls: Array<{ url: URL; init: RequestInit | undefined }>;
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

export function mockFetch(routes: readonly Route[]): MockFetch {
  const calls: Array<{ url: URL; init: RequestInit | undefined }> = [];
  const impl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    calls.push({ url, init });
    const route = routes.find((r) => r.match(url, init));
    if (!route) return json({ error: `no mock for ${url.pathname}` }, 404);
    return route.respond(url, init);
  };
  return { fetch: impl as typeof fetch, calls };
}

export const isS2 = (path: string) => (url: URL) => url.hostname === "api.semanticscholar.org" && url.pathname === `/graph/v1${path}`;
export const isOA = (path: string, pred: (url: URL) => boolean = () => true) => (url: URL) =>
  url.hostname === "api.openalex.org" && url.pathname === path && pred(url);
