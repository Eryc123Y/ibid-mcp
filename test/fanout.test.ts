import {beforeEach, expect,it,vi} from 'vitest';
import {SourceLimiter} from '../src/limiter/source-limiter';
import {createToolContext, sourceReport} from '../src/tools/context';
import {searchPapers} from '../src/tools/papers';
import {clearMemoryCache} from '../src/http/cache';
import {memoryState} from './helpers/storage';
import {isS2,isOA,json,mockFetch} from './helpers/mock-fetch';
import type {AppEnv} from '../src/env';
beforeEach(()=>clearMemoryCache());
export function mockEnv():AppEnv {
 const limiter={reserve:vi.fn(async()=>({ok:true,waitMs:0})),penalize:vi.fn(),recordHeaders:vi.fn(),status:vi.fn(async()=>null)};
 return {PUBLIC_URL:'https://worker.example',SOURCE_LIMITER:{idFromName:(s:string)=>s,get:()=>limiter}} as unknown as AppEnv;
}
it('persists source schedules, has independent intervals and skips waits above ten seconds',async()=>{
 vi.useFakeTimers();vi.setSystemTime(0);const {state}=memoryState();
 const a=new SourceLimiter(state,{} as AppEnv);
 expect(await a.reserve('s2')).toEqual({ok:true,waitMs:0});
 expect(await new SourceLimiter(state,{} as AppEnv).reserve('s2')).toEqual({ok:true,waitMs:3000});
 await a.reserve('s2');await a.reserve('s2');expect(await a.reserve('s2')).toEqual({ok:false,retryAfterMs:12000});
 const keyed=new SourceLimiter(memoryState().state,{S2_API_KEY:'test'} as AppEnv);await keyed.reserve('s2');expect(await keyed.reserve('s2')).toMatchObject({waitMs:1000});
 const oa=new SourceLimiter(memoryState().state,{} as AppEnv);await oa.reserve('openalex');expect(await oa.reserve('openalex')).toMatchObject({waitMs:100});
});
it('retains quota headers and delays reservations after rate-limit exhaustion',async()=>{
 const a=new SourceLimiter(memoryState().state,{} as AppEnv);
 await a.recordHeaders({'x-ratelimit-limit':'1000','x-ratelimit-remaining':'200'},'openalex');
 expect(await a.status()).toMatchObject({remaining:200,limit:1000,warning:true});
 await a.penalize(20_000);expect(await a.reserve('s2')).toMatchObject({ok:false});
});
it('fans out, fills abstracts, deduplicates, and returns compact rows and source reports',async()=>{
 const mock=mockFetch([
 {match:isS2('/paper/search'),respond:()=>json({data:[{paperId:'s',title:'A shared example title',year:2024,externalIds:{DOI:'10.1/example'}}]})},
 {match:isOA('/works'),respond:()=>json({results:[{id:'https://openalex.org/W1',display_name:'A shared example title',publication_year:2024,doi:'https://doi.org/10.1/example',abstract_inverted_index:{['x'.repeat(500)]:[0]}},{id:'https://openalex.org/W2',display_name:'Additional journal paper',publication_year:2024}]})},
 ]);vi.stubGlobal('fetch',mock.fetch);const ctx=createToolContext(mockEnv());
 const result=await searchPapers(ctx,{query:'example',limit:10,offset:0});
 expect(result.papers).toHaveLength(2);expect(result.papers[0]?.abstract?.length).toBeLessThanOrEqual(300);
 expect(sourceReport(ctx)).toMatchObject({sources_used:['s2','openalex'],sources_skipped:[]});
 expect(mock.calls.some(c=>c.url.searchParams.has('mailto'))).toBe(false);
});
it('returns OpenAlex rows when S2 would wait too long, marking the exact failed source',async()=>{
 const env=mockEnv();
 const base=env.SOURCE_LIMITER.get('' as never) as unknown as {reserve:ReturnType<typeof vi.fn>};
 base.reserve.mockImplementation(async(s:string)=>s==='s2'?{ok:false,retryAfterMs:12000}:{ok:true,waitMs:0});
 vi.stubGlobal('fetch',mockFetch([{match:isOA('/works'),respond:()=>json({results:[{id:'https://openalex.org/W3',display_name:'Journal result'}]})}]).fetch);
 const ctx=createToolContext(env);const result=await searchPapers(ctx,{query:'journal',limit:10,offset:0});
 expect(result.papers).toHaveLength(1);expect(sourceReport(ctx).sources_skipped).toEqual([expect.objectContaining({source:'s2',reason:expect.stringMatching(/12/)})]);
});
it('does not merge equal titles from different years',async()=>{
 const {dedupePapers}=await import('../src/core/dedupe');expect(dedupePapers([{source:'s2',id:'a',title:'Identical title across years',year:2023,authors:[]},{source:'openalex',id:'b',title:'Identical title across years',year:2024,authors:[]}])).toHaveLength(2);
});
