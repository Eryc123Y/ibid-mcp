import {expect,it} from 'vitest';
import {evaluateCoverage,validateSample,type CoverageSample} from '../eval/coverage';
function sample():CoverageSample {
 return {provenance:{kind:'recorded',source:'reference measurement',seed:7,recorded_at:'2026-11-11'},papers:Array.from({length:600},(_,i)=>({id:`W${i}`,title:`Distinct synthetic evaluation paper ${i}`,year:2024,venue:`Venue ${Math.floor(i/40)}`,on_arxiv:i<210}))};
}
it('requires 600 unique papers, 15 venues and 40 papers per venue',()=>{
 expect(()=>validateSample(sample())).not.toThrow();
 expect(()=>validateSample({...sample(),papers:sample().papers.slice(1)})).toThrow('600');
 const duplicate=sample();duplicate.papers[1]=duplicate.papers[0]!;expect(()=>validateSample(duplicate)).toThrow('unique');
});
it('scores actual search outputs by title, enforces 90%, and computes the arxiv baseline',async()=>{
 const data=sample();const passed=await evaluateCoverage(data,async p=>({papers:Number(p.id.slice(1))<540?[{title:p.title}]:[]}));
 expect(passed).toMatchObject({found:540,total:600,coverage:0.9,passed:true,arxiv_baseline:0.35});
 const failed=await evaluateCoverage(data,async()=>({papers:[{title:'Unrelated title'}]}));expect(failed.passed).toBe(false);expect(failed.missing).toHaveLength(600);
});
it('rejects invented provenance for the real acceptance gate and flags year mismatches',()=>{
 expect(()=>validateSample({...sample(),provenance:{...sample().provenance,kind:'synthetic'}})).toThrow('recorded');
 const invalid=sample();invalid.papers[0]={...invalid.papers[0]!,year:2023};expect(()=>validateSample(invalid)).toThrow('2024');
 invalid.papers[0]={...invalid.papers[0]!,venue:'ICCV'};expect(()=>validateSample(invalid)).toThrow('15 venues');
});

it('replays recorded response shapes through the real search adapters without network access',async()=>{
 const {evaluateSnapshot}=await import('../eval/replay');const data=sample();
 const responses=Object.fromEntries(data.papers.map(p=>[p.id,{s2:[{status:200,body:{data:[]}}],openalex:[{status:200,body:{results:[{id:`https://openalex.org/${p.id}`,display_name:p.title,publication_year:p.year}]}}]}]));
 const result=await evaluateSnapshot({sample:data,responses});expect(result.found).toBe(600);
 await expect(evaluateSnapshot({sample:data,responses:{}})).rejects.toThrow('Missing recorded');
});
