/**
 * Short-lived response cache: an in-isolate LRU map backed by the Workers Cache API.
 * The Cache API is per data centre and may be a no-op in local development; the map still helps
 * within a warm isolate. Keys must never contain secrets (strip api keys before calling).
 */

interface Entry {
  readonly expires: number;
  readonly body: string;
}

const MAX_ENTRIES = 300;
const memory = new Map<string, Entry>();
const CACHE_NAME = "scholar-mcp-v1";

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

function memoryGet(key: string, now: number): string | undefined {
  const hit = memory.get(key);
  if (!hit) return undefined;
  if (hit.expires <= now) {
    memory.delete(key);
    return undefined;
  }
  memory.delete(key);
  memory.set(key, hit); // refresh LRU position
  return hit.body;
}

function memorySet(key: string, body: string, ttlSeconds: number, now: number): void {
  memory.set(key, { body, expires: now + ttlSeconds * 1000 });
  while (memory.size > MAX_ENTRIES) {
    const oldest = memory.keys().next().value;
    if (oldest === undefined) break;
    memory.delete(oldest);
  }
}

async function openCache(): Promise<Cache | undefined> {
  try {
    return typeof caches === "undefined" ? undefined : await caches.open(CACHE_NAME);
  } catch {
    return undefined;
  }
}

/**
 * Return a cached body for `key`, or run `load` and cache its body when `cacheable` is true.
 */
export async function cached(
  key: string,
  ttlSeconds: number,
  load: () => Promise<{ readonly body: string; readonly cacheable: boolean }>,
): Promise<string> {
  const now = Date.now();
  const fromMemory = memoryGet(key, now);
  if (fromMemory !== undefined) return fromMemory;

  const cacheKey = `https://cache.scholar-mcp.internal/${await sha256Hex(key)}`;
  const cache = await openCache();
  const hit = await cache?.match(cacheKey).catch(() => undefined);
  if (hit) {
    const body = await hit.text();
    memorySet(key, body, ttlSeconds, now);
    return body;
  }

  const { body, cacheable } = await load();
  if (cacheable) {
    memorySet(key, body, ttlSeconds, now);
    const response = new Response(body, { headers: { "cache-control": `max-age=${ttlSeconds}` } });
    await cache?.put(cacheKey, response).catch(() => undefined);
  }
  return body;
}

/** Test hook. */
export function clearMemoryCache(): void {
  memory.clear();
}
