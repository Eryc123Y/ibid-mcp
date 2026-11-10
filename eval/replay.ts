import {createS2Client} from '../src/sources/s2';
import {createOpenAlexClient} from '../src/sources/openalex';
import {searchPapers} from '../src/tools/search';
import {clearMemoryCache} from '../src/http/cache';
import {track,type SourceReport} from '../src/tools/provenance';
import {evaluateCoverage,type CoverageSample} from './coverage';
export interface RecordedResponse {status:number;headers?:Record<string,string>;body:unknown}
export interface CoverageSnapshot {sample:CoverageSample;responses:Record<string,{s2:RecordedResponse[];openalex:RecordedResponse[]}>}
/** Replays recorded upstream replies through the real adapters and search implementation. No fetch fallback. */
export async function evaluateSnapshot(snapshot:CoverageSnapshot) {
  clearMemoryCache();
  return evaluateCoverage(snapshot.sample,async paper=>{
    const replies=snapshot.responses[paper.id];if(!replies)throw new Error(`Missing recorded responses for ${paper.id}`);
    const queues={s2:[...replies.s2],openalex:[...replies.openalex]};
    const fetchImpl:typeof fetch=async(input)=>{
      const url=new URL(String(input));
      const source=url.hostname==='api.semanticscholar.org'?'s2':url.hostname==='api.openalex.org'?'openalex':null;
      if(!source)throw new Error('Unexpected source in offline evaluation');
      const response=queues[source].shift();if(!response)throw new Error(`Recorded response exhausted for ${paper.id}/${source}`);
      return new Response(JSON.stringify(response.body),{status:response.status,headers:response.headers});
    };
    const report:SourceReport={sources_used:[],sources_skipped:[]};
    const context={s2:track(createS2Client({fetchImpl,acquire:async()=>{},penalize:async()=>{},sleep:async()=>{}}),'s2',report),
      oa:track(createOpenAlexClient({fetchImpl,sleep:async()=>{}}),'openalex',report),notices:[],report};
    return searchPapers(context,{query:paper.title,limit:10,offset:0});
  });
}
