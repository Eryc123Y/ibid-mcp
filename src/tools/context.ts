import type { Notice } from '../core/types';
import type { AppEnv } from '../env';
import { sourceDeps, RateLimitedError } from '../limiter/source-limiter';
import { budgetNotice, createOpenAlexClient, type OpenAlexClient } from '../sources/openalex';
import { createS2Client, type S2Client } from '../sources/s2';
import { track, failureReason, type SourceReport } from './provenance';
export interface ToolContext {
  readonly s2:S2Client;
  readonly oa:OpenAlexClient;
  readonly notices:Notice[];
  readonly report?:SourceReport;
}
export function createToolContext(env:AppEnv):ToolContext {
  const report:SourceReport={sources_used:[],sources_skipped:[]};
  return {s2:track(createS2Client({apiKey:env.S2_API_KEY || undefined,...sourceDeps(env,'s2')}),'s2',report),
    oa:track(createOpenAlexClient({apiKey:env.OPENALEX_API_KEY || undefined,...sourceDeps(env,'openalex')}),'openalex',report),notices:[],report};
}
export function sourceReport(ctx:ToolContext):SourceReport {return ctx.report ?? {sources_used:[],sources_skipped:[]};}
export async function withFallback<T>(ctx:ToolContext,primary:()=>Promise<T>,fallback:()=>Promise<T>):Promise<T> {
  try{return await primary();}catch(error){
    ctx.notices.push({level:'warn',text:`${error instanceof RateLimitedError?'Semantic Scholar queue is full':failureReason(error)} (source unavailable); fell back to OpenAlex.`});
    return fallback();
  }
}
export async function optional<T>(operation:()=>Promise<T>,fallback:T):Promise<T> {try{return await operation();}catch{return fallback;}}
export function collectNotices(ctx:ToolContext):Notice[] {const budget=budgetNotice();return budget?[...ctx.notices,budget]:[...ctx.notices];}
