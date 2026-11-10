import {beforeEach,expect,it,vi} from 'vitest';
import {getPapers,paperLinks} from '../src/tools/papers';
import {createToolContext} from '../src/tools/context';
import {clearMemoryCache} from '../src/http/cache';
import type {AppEnv} from '../src/env';
import {mockFetch,json,isS2,isOA} from './helpers/mock-fetch';
const env={SOURCE_LIMITER:{idFromName:(s:string)=>s,get:()=>({reserve:async()=>({ok:true,waitMs:0}),recordHeaders:async()=>{}})}} as unknown as AppEnv;
beforeEach(()=>clearMemoryCache());
it('resolves a title alongside batched ids and rejects an oversized batch',async()=>{
 vi.stubGlobal('fetch',mockFetch([
 {match:isS2('/paper/search'),respond:()=>json({data:[{paperId:'s',title:'The exact paper title',abstract:'found',year:2024}]})},
 {match:isS2('/paper/batch'),respond:()=>json([{paperId:'id',title:'An id result',abstract:'found'}])},
 {match:isOA('/works'),respond:()=>json({results:[]})},
 ]).fetch);
 const result=await getPapers(createToolContext(env),['The exact paper title','CorpusId:1'],false);
 expect(result).toContain('The exact paper title');expect(result).toContain('An id result');
 await expect(getPapers(createToolContext(env),Array.from({length:21},()=> 'CorpusId:1'),false)).rejects.toThrow('20');
});
it('paginates Semantic Scholar recommendations',async()=>{
 const mock=mockFetch([{match:u=>u.pathname==='/recommendations/v1/papers/for/CorpusId%3A1',respond:()=>json({recommendedPapers:[{paperId:'a',title:'First recommendation'},{paperId:'b',title:'Second recommendation'},{paperId:'c',title:'Third recommendation'}]})}]);
 vi.stubGlobal('fetch',mock.fetch);
 const result=await paperLinks(createToolContext(env),{id:'CorpusId:1',direction:'recommendations',limit:1,offset:1});
 expect(result).toContain('Second recommendation');expect(result).not.toContain('First recommendation');expect(result).toContain('offset=2');
});
