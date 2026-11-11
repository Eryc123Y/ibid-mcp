/** Live collection, deliberately separate from the frozen offline evaluator. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { createS2Client } from "../src/sources/s2";
import { createOpenAlexClient } from "../src/sources/openalex";
import { HttpError } from "../src/http/json";
import {
  creditRoom,
  sourceFor,
  validateVenueDraw,
  probeBudget,
} from "./collection-policy";
import { validateSample } from "./coverage";
import type { CoverageSnapshot, RecordedResponse } from "./replay";

const ROOT = ".artifacts/p5";
const venues: Array<[string, string, string?]> = [
  ["CVPR", "Computer Vision and Pattern Recognition", "S4210176548"],
  ["NeurIPS", "Neural Information Processing Systems"],
  [
    "ACL",
    "Annual Meeting of the Association for Computational Linguistics",
    "S4393915740",
  ],
  ["TPAMI", "IEEE Transactions on Pattern Analysis and Machine Intelligence"],
  ["TIP", "IEEE Transactions on Image Processing"],
  ["TCSVT", "IEEE Transactions on Circuits and Systems for Video Technology"],
  ["TVCG", "IEEE Transactions on Visualization and Computer Graphics"],
  ["ACM TOG", "ACM Transactions on Graphics"],
  ["Pattern Recognition", "Pattern Recognition"],
  ["Neurocomputing", "Neurocomputing"],
  ["Neural Networks", "Neural Networks"],
  [
    "ICASSP",
    "IEEE International Conference on Acoustics, Speech, and Signal Processing",
  ],
  ["ICIP", "IEEE International Conference on Image Processing", "S4210223844"],
  ["Journal of Vision", "Journal of Vision"],
  ["ICCV", "ICCV", "S4363607764"],
];
interface Work {
  id: string;
  title: string;
  publication_year: number;
  doi?: string;
  locations?: Array<{
    source?: { display_name?: string };
    landing_page_url?: string;
    pdf_url?: string;
  }>;
}
interface State {
  day: string;
  spent: number;
  remaining: number;
  limit: number;
  blockedUntil: number;
  sources: Record<string, string>;
  draws: Record<string, Work[]>;
  arxiv: Record<string, boolean>;
  complete: Record<string, boolean>;
  snapshot: CoverageSnapshot;
  requests: Record<string, number>;
}
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const save = (path: string, value: unknown) =>
  writeFile(path, JSON.stringify(value, null, 2) + "\n");
const today = () => new Date().toISOString().slice(0, 10);
export async function collect(availability?: {
  recorded_at: string;
  status: number;
  headers: Record<string, string>;
}) {
  await mkdir(ROOT, { recursive: true });
  const reference = join(
    homedir(),
    "GitHub/daily-arXiv-ai-enhanced/docs/measurements",
  );
  const files = await Promise.all(
    ["arxiv-coverage.md", "venues.py", "verify.py"].map(async (name) => {
      const text = await readFile(join(reference, name), "utf8");
      return {
        name,
        text,
        sha256: createHash("sha256").update(text).digest("hex"),
      };
    }),
  );
  await save(
    `${ROOT}/reference-hashes.json`,
    files.map(({ name, sha256 }) => ({ name, sha256 })),
  );
  let state: State;
  try {
    state = JSON.parse(await readFile(`${ROOT}/state.json`, "utf8")) as State;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    state = {
      day: today(),
      spent: 0,
      remaining: 1000,
      limit: 1000,
      blockedUntil: 0,
      sources: {},
      draws: {},
      arxiv: {},
      complete: {},
      requests: {},
      snapshot: {
        sample: {
          provenance: {
            kind: "recorded",
            source:
              "Rebuilt from daily-arXiv measurement scripts; original output absent; see reference-hashes.json and collection documentation",
            seed: 7,
            recorded_at: new Date().toISOString(),
          },
          papers: [],
        },
        responses: {},
      },
    };
  }
  if (state.day !== today())
    Object.assign(state, {
      day: today(),
      spent: 0,
      remaining: 1000,
      limit: 1000,
    });
  if (availability?.status === 429) {
    const reset = Number(availability.headers["retry-after"]);
    state.blockedUntil = Math.max(
      state.blockedUntil,
      Date.parse(availability.recorded_at) + reset * 1000,
    );
  }
  const checkpoint = async () => {
    await save(`${ROOT}/state.json`, state);
    await save(`${ROOT}/recorded-600.json`, state.snapshot);
  };
  await checkpoint();
  if (state.blockedUntil > Date.now())
    throw new Error(
      `OpenAlex unavailable until ${new Date(state.blockedUntil).toISOString()}; no new requests sent`,
    );
  const last: Record<string, number> = {};
  const get: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const source = url.hostname === "api.openalex.org" ? "openalex" : "s2";
    if (!["api.openalex.org", "api.semanticscholar.org"].includes(url.hostname))
      throw new Error("Unexpected API host");
    if (["api_key", "mailto"].some((k) => url.searchParams.has(k)))
      throw new Error("Keyless collection only");
    const cost = /^\/works\/[^/]+$/.test(url.pathname)
      ? 0
      : url.searchParams.has("search")
        ? 10
        : 1;
    if (
      source === "openalex" &&
      (state.blockedUntil > Date.now() ||
        !creditRoom(state.limit, state.remaining, state.spent, cost))
    )
      throw new Error(
        "OpenAlex daily collection budget exhausted; resume after reset",
      );
    await sleep(Math.max(0, (last[source] ?? 0) + 3100 - Date.now()));
    last[source] = Date.now();
    if (source === "openalex") {
      state.spent += cost;
      state.remaining -= cost;
    }
    state.requests[source] = (state.requests[source] ?? 0) + 1;
    await checkpoint(); // Reserve credits even if the connection fails.
    const response = await fetch(input, {
      ...init,
      signal: AbortSignal.timeout(60000),
    });
    if (source === "openalex") {
      const h = response.headers;
      if (h.has("x-ratelimit-remaining"))
        state.remaining = Number(h.get("x-ratelimit-remaining"));
      if (h.has("x-ratelimit-limit"))
        state.limit = Number(h.get("x-ratelimit-limit"));
      if (response.status === 429)
        state.blockedUntil =
          Date.now() + Number(h.get("retry-after") || 86400) * 1000;
    }
    await checkpoint();
    return response;
  };
  Object.assign(state, await probeBudget(get));
  await checkpoint();
  for (const [venue, name, fixed] of venues) {
    if (state.draws[venue]) continue;
    if (!state.sources[venue]) {
      if (fixed) state.sources[venue] = fixed;
      else {
        const q = new URLSearchParams({
          search: name,
          "per-page": "5",
          select: "id,display_name,works_count,type",
        });
        const r = await get(`https://api.openalex.org/sources?${q}`);
        if (!r.ok)
          throw new Error(`Source discovery returned HTTP ${r.status}`);
        state.sources[venue] = sourceFor(
          name,
          ((await r.json()) as { results: Parameters<typeof sourceFor>[1] })
            .results,
        );
      }
      await checkpoint();
    }
    const year = venue === "ICCV" ? 2023 : 2024;
    const q = new URLSearchParams({
      filter: `primary_location.source.id:${state.sources[venue]},publication_year:${year}`,
      sample: "40",
      seed: "7",
      "per-page": "40",
      select: "id,doi,title,publication_year,locations,primary_location",
    });
    const r = await get(`https://api.openalex.org/works?${q}`);
    if (!r.ok) throw new Error(`Venue sampling returned HTTP ${r.status}`);
    const rows = ((await r.json()) as { results: Work[] }).results;
    await save(`${ROOT}/draw-${venue.replace(/\W/g, "_")}.json`, rows);
    validateVenueDraw(rows, year);
    state.draws[venue] = rows;
    await checkpoint();
  }
  // Run the reviewed reference title verifier, read-only, using HTTPS instead of HTTP.
  // It retains its original SequenceMatcher >0.9 and first twelve >=3-letter words.
  for (const [venue] of venues) {
    const rows = state.draws[venue]!;
    if (rows.every((w) => w.id in state.arxiv)) continue;
    const path = `${ROOT}/verify-${venue.replace(/\W/g, "_")}.json`;
    const works = rows.map((w) => ({
      id: w.id,
      title: w.title,
      arxiv: (w.locations ?? []).some(
        (l) =>
          (l.source?.display_name ?? "").toLowerCase().includes("arxiv") ||
          `${l.landing_page_url ?? ""}${l.pdf_url ?? ""}`.includes("arxiv.org"),
      ),
    }));
    await save(path, works);
    const code = files
      .find((f) => f.name === "verify.py")!
      .text.replaceAll("http://export.arxiv.org", "https://export.arxiv.org");
    execFileSync("python3", ["-c", code, path], { stdio: "inherit" });
    const verified = JSON.parse(await readFile(path, "utf8")) as Array<{
      id: string;
      arxiv: boolean;
      arxiv_by_title?: boolean | null;
    }>;
    for (const w of verified) {
      if (w.arxiv) state.arxiv[w.id] = true;
      else if (typeof w.arxiv_by_title === "boolean")
        state.arxiv[w.id] = w.arxiv_by_title;
    }
    await checkpoint();
    if (!rows.every((w) => w.id in state.arxiv))
      throw new Error(
        `Unknown arXiv observations in ${venue}; no false observations substituted`,
      );
  }
  state.snapshot.sample.papers = venues.flatMap(([venue]) =>
    state.draws[venue]!.map((w) => ({
      id: w.id,
      title: w.title,
      year: w.publication_year,
      venue,
      on_arxiv: state.arxiv[w.id]!,
    })),
  );
  validateSample(state.snapshot.sample);
  await checkpoint();
  // Interleave venues so any daily partial collection covers them as evenly as possible.
  const papers = Array.from({ length: 40 }, (_, i) =>
    venues.map(
      ([v]) => state.snapshot.sample.papers.filter((p) => p.venue === v)[i]!,
    ),
  ).flat();
  let throttled = 0;
  for (const paper of papers) {
    for (const source of ["openalex", "s2"] as const) {
      const key = `${paper.id}/${source}`;
      if (state.complete[key]) continue;
      const replies: RecordedResponse[] = [];
      const fetchImpl: typeof fetch = async (input, init) => {
        const r = await get(input, init);
        const body = (await r.clone().json()) as {
          results?: Array<Record<string, unknown>>;
          data?: Array<Record<string, unknown>>;
        };
        // Retain only public metadata; abstracts are unnecessary for title scoring.
        for (const w of body.results ?? body.data ?? []) {
          delete w.abstract;
          delete w.abstract_inverted_index;
        }
        replies.push({
          status: r.status,
          headers: Object.fromEntries(
            [...r.headers].filter(([k]) =>
              /^x-ratelimit-|^retry-after$/.test(k),
            ),
          ),
          body,
        });
        state.snapshot.responses[paper.id] ??= { s2: [], openalex: [] };
        state.snapshot.responses[paper.id]![source] = replies;
        await checkpoint();
        return r;
      };
      try {
        if (source === "openalex")
          await createOpenAlexClient({ fetchImpl }).searchWorks(paper.title, {
            limit: 10,
            page: 1,
          });
        else
          await createS2Client({
            fetchImpl,
            acquire: async () => {},
            penalize: async () => {},
          }).searchPapers(paper.title, { limit: 10, offset: 0 });
        if (source === "s2") throttled = 0;
      } catch (error) {
        if (!(error instanceof HttpError)) throw error;
        if (error.status === 429 && source === "s2") throttled++;
      }
      state.complete[key] = true;
      await checkpoint();
      if (throttled >= 3)
        throw new Error(
          "Three S2 title queries exhausted retries; stop until service recovers",
        );
    }
    console.log(`Recorded ${paper.venue}: ${paper.id}`);
  }
  await save(`${ROOT}/collection-status.json`, {
    status: "recorded",
    requests: state.requests,
    bytes: Buffer.byteLength(JSON.stringify(state.snapshot)),
  });
}
