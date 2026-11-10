/** Builds the MCP server and registers the five tools. */

import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { noticesBlock } from "../core/format";
import { IdParseError } from "../core/ids";
import type { AppEnv } from "../env";
import { HttpError } from "../http/json";
import { RateLimitedError } from "../limiter/s2-limiter";
import { coauthorship, getAuthor } from "./authors";
import { collectNotices, createToolContext, type ToolContext } from "./context";
import { SERVER_INSTRUCTIONS, TOOL_DESCRIPTIONS } from "./instructions";
import { getPapers, paperLinks, searchPapers } from "./papers";

export const SERVER_NAME = "scholar";
export const SERVER_VERSION = "0.1.0";

type ToolResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

function errorText(error: unknown): string {
  if (error instanceof RateLimitedError || error instanceof IdParseError) return error.message;
  if (error instanceof HttpError) return `${error.message}. Try again later or rephrase.`;
  return `Unexpected error: ${error instanceof Error ? error.message : String(error)}`;
}

async function run(env: AppEnv, body: (ctx: ToolContext) => Promise<string>): Promise<ToolResult> {
  const ctx = createToolContext(env);
  try {
    const text = await body(ctx);
    return { content: [{ type: "text", text: `${noticesBlock(collectNotices(ctx))}${text}` }] };
  } catch (error) {
    return { content: [{ type: "text", text: `${noticesBlock(collectNotices(ctx))}${errorText(error)}` }], isError: true };
  }
}

const limit = (max: number) => z.number().int().min(1).max(max).default(10).describe(`Max items (default 10, max ${max})`);
const offset = z.number().int().min(0).max(9999).default(0).describe("Pagination offset");
const year = z.number().int().min(1800).max(2100);

export function buildServer(env: AppEnv): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, { instructions: SERVER_INSTRUCTIONS });

  server.registerTool(
    "search_papers",
    {
      title: "Search papers",
      description: TOOL_DESCRIPTIONS.search_papers,
      inputSchema: z.object({
        query: z.string().min(2).max(300).describe("Keywords or a title"),
        year_from: year.optional(),
        year_to: year.optional(),
        venue: z.string().max(200).optional().describe("Venue name or ISO4 abbreviation, comma-separated for several"),
        limit: limit(50),
        offset,
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => run(env, (ctx) => searchPapers(ctx, args)),
  );

  server.registerTool(
    "get_paper",
    {
      title: "Get paper details",
      description: TOOL_DESCRIPTIONS.get_paper,
      inputSchema: z.object({
        ids: z.union([z.string().min(3), z.array(z.string().min(3)).min(1).max(20)]).describe("One id or a list of up to 20"),
        full: z.boolean().default(false).describe("Full abstract and author list"),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ ids, full }) => run(env, (ctx) => getPapers(ctx, Array.isArray(ids) ? ids : [ids], full)),
  );

  server.registerTool(
    "paper_links",
    {
      title: "Citations or references",
      description: TOOL_DESCRIPTIONS.paper_links,
      inputSchema: z.object({
        id: z.string().min(3).describe("Paper id (same formats as get_paper)"),
        direction: z.enum(["citations", "references"]),
        limit: limit(100),
        offset,
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => run(env, (ctx) => paperLinks(ctx, args)),
  );

  server.registerTool(
    "get_author",
    {
      title: "Get author (merged)",
      description: TOOL_DESCRIPTIONS.get_author,
      inputSchema: z.object({
        name_or_id: z.string().min(2).max(200),
        affiliation_hint: z.string().max(200).optional().describe("e.g. 'Monash' or 'NTU Singapore'"),
        include_papers: z.boolean().default(false),
        sort: z.enum(["recent", "cited"]).default("recent"),
        limit: limit(100),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => run(env, (ctx) => getAuthor(ctx, args)),
  );

  server.registerTool(
    "coauthorship",
    {
      title: "Shared papers of two authors",
      description: TOOL_DESCRIPTIONS.coauthorship,
      inputSchema: z.object({
        author_a: z.string().min(2).max(200).describe("Name or id"),
        author_b: z.string().min(2).max(200).describe("Name or id"),
        affiliation_a: z.string().max(200).optional(),
        affiliation_b: z.string().max(200).optional(),
        limit: limit(100),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => run(env, (ctx) => coauthorship(ctx, args)),
  );

  return server;
}
