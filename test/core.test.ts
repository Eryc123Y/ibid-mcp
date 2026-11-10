import {beforeEach,expect,it,vi} from 'vitest';
import fixture from './fixtures/core.json';
import {createCoreClient} from '../src/sources/core';
import {createToolContext,sourceReport} from '../src/tools/context';
import {getPapers} from '../src/tools/papers';
import {searchPapers} from '../src/tools/search';
import {clearMemoryCache} from '../src/http/cache';
import type {AppEnv} from '../src/env';
import {json,mockFetch,isS2,isOA} from './helpers/mock-fetch';
beforeEach(()=>clearMemoryCache());
function env(key?:string):AppEnv {return {CORE_API_KEY:key,SOURCE_LIMITER:{idFromName:(s:string)=>s,get:()=>({reserve:async()=>({ok:true,waitMs:0}),recordHeaders:async()=>{}})}} as unknown as AppEnv;}
it('uses a Bearer key, maps OA links and returns bounded snippets',async()=>{
 const fetchImpl=vi.fn(async(_url:RequestInfo|URL,_init?:RequestInit)=>json(fixture));
 const c=createCoreClient({apiKey:'synthetic-key',acquire:async()=>{},penalize:async()=>{},fetchImpl});
 const found=await c.lookup({doi:'10.1234/synthetic',title:'A synthetic open access paper'});
 expect(found).toMatchObject({url:'https://repository.example/paper.pdf',source:'core',snippet:'A publicly available text excerpt. More details are omitted from the compact result.'});
 expect(String(fetchImpl.mock.calls[0]?.[0])).not.toContain('synthetic-key');expect(new Headers(fetchImpl.mock.calls[0]?.[1]?.headers).get('authorization')).toBe('Bearer synthetic-key');
});
it('skips without a key without issuing a request',async()=>{
 const fetchImpl=vi.fn();const c=createCoreClient({acquire:async()=>{},penalize:async()=>{},fetchImpl});
 await expect(c.search('query',10,0)).rejects.toThrow('CORE_API_KEY');expect(fetchImpl).not.toHaveBeenCalled();
});
it('never attaches an unrelated search hit to a paper',async()=>{
 const c=createCoreClient({apiKey:'test',acquire:async()=>{},penalize:async()=>{},fetchImpl:async()=>json(fixture)});
 expect(await c.lookup({doi:'10.1234/different',title:'Different paper'})).toBeNull();
});
it('adds CORE to open-access search and get_paper OA output, reporting keyless skip',async()=>{
 const mock=mockFetch([
 {match:isS2('/paper/search'),respond:()=>json({data:[]})}, {match:isOA('/works'),respond:()=>json({results:[]})},
 {match:isS2('/paper/batch'),respond:()=>json([{paperId:'s',title:'A synthetic open access paper',abstract:'Abstract',externalIds:{DOI:'10.1234/SYNTHETIC'}}])},
 {match:u=>u.hostname==='api.core.ac.uk',respond:()=>json(fixture)},
 ]);vi.stubGlobal('fetch',mock.fetch);
 const ctx=createToolContext(env('test'));expect((await searchPapers(ctx,{query:'synthetic',open_access:true,limit:10,offset:0})).papers).toHaveLength(1);
 const papers=await getPapers(ctx,['10.1234/synthetic'],false);expect(papers.papers[0]?.oa).toMatchObject({source:'core',url:'https://repository.example/paper.pdf'});
 const keyless=createToolContext(env());await getPapers(keyless,['10.1234/synthetic'],false);
 expect(sourceReport(keyless).sources_skipped).toContainEqual({source:'core',reason:'CORE_API_KEY not configured'});
});
