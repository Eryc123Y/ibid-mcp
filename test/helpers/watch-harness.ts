/** Shared setup for `litscout watch` tests: in-memory files, a fixed clock and a route-based fetch mock. */

import { readFileSync } from "node:fs";
import { runWatch, type WatchDeps } from "../../cli/watch/run";
import { mockFetch, type Route } from "./mock-fetch";

export const TODAY = new Date("2026-11-12T09:00:00Z");

export function fixture(name: string): string {
  return readFileSync(
    new URL(`../fixtures/watch/${name}`, import.meta.url),
    "utf8",
  );
}

export function text(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

export const host = (name: string) => (url: URL) => url.hostname === name;

export interface Harness {
  readonly deps: WatchDeps;
  readonly calls: ReturnType<typeof mockFetch>["calls"];
  readonly files: Map<string, string>;
  readonly err: string[];
  readonly lines: () => Array<Record<string, unknown>>;
  readonly run: (argv: readonly string[]) => Promise<number>;
  readonly stderr: () => string;
}

/** `venues` becomes the file `list.json`; `files` seeds the in-memory file system. */
export function harness(
  venues: unknown[],
  routes: Route[],
  env: WatchDeps["env"] = {},
  files: Record<string, string> = {},
): Harness {
  const mock = mockFetch(routes);
  const store = new Map<string, string>(Object.entries(files));
  store.set("list.json", JSON.stringify({ venues }));
  const out: string[] = [];
  const err: string[] = [];
  const deps: WatchDeps = {
    fetch: mock.fetch,
    env,
    readFile: async (file) => {
      const found = store.get(file);
      if (found === undefined) throw new Error(`ENOENT ${file}`);
      return found;
    },
    writeFile: async (file, body) => {
      store.set(file, body);
    },
    stdout: (chunk) => out.push(chunk),
    stderr: (chunk) => err.push(chunk),
    sleep: async () => {},
    now: () => TODAY,
  };
  return {
    deps,
    calls: mock.calls,
    files: store,
    err,
    lines: () =>
      out
        .join("")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l) as Record<string, unknown>),
    run: (argv) => runWatch(argv, deps),
    stderr: () => err.join(""),
  };
}
