import {dedupePapers} from '../core/dedupe';
import type {Paper} from '../core/types';
import {optional,type ToolContext} from './context';
export interface SearchArgs {
  readonly query:string;
  readonly year_from?:number;
  readonly year_to?:number;
  readonly venue?:string;
  readonly limit:number;
  readonly offset:number;
  readonly full?:boolean;
  readonly recent?:boolean;
  readonly category?:string;
  readonly open_access?:boolean;
}
export function compactPaper(paper:Paper,full=false):Paper {
  return {...paper,abstract:full?paper.abstract:paper.abstract?.slice(0,300),authors:full?paper.authors:paper.authors.slice(0,5)};
}
export async function searchPapers(ctx:ToolContext,args:SearchArgs) {
  const [s2,oa]=await Promise.all([
    optional(()=>ctx.s2.searchPapers(args.query,{yearFrom:args.year_from,yearTo:args.year_to,venue:args.venue,limit:args.limit,offset:args.offset}),{total:0,papers:[]}),
    optional(()=>ctx.oa.searchWorks(args.query,{yearFrom:args.year_from,yearTo:args.year_to,limit:args.limit,page:Math.floor(args.offset/args.limit)+1}),{count:0,papers:[]}),
  ]);
  const papers=dedupePapers([...s2.papers,...oa.papers]).filter(p=>!args.venue || p.venue?.toLowerCase().includes(args.venue.toLowerCase()));
  return {papers:papers.slice(0,args.limit).map(p=>compactPaper(p,args.full)),next_offset:Math.max(s2.total,oa.count)>args.offset+args.limit?args.offset+args.limit:undefined};
}
