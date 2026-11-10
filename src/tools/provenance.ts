import {MissingCoreKeyError} from "../sources/core";
import { HttpError } from '../http/json';
import { RateLimitedError } from '../limiter/source-limiter';
export interface SourceReport { sources_used:string[]; sources_skipped:Array<{source:string;reason:string}> }
export function failureReason(error:unknown):string {
  if(error instanceof MissingCoreKeyError)return error.message;
  if(error instanceof RateLimitedError)return error.message;
  if(error instanceof HttpError)return `HTTP ${error.status}`;
  return 'Source unavailable or invalid response';
}
/** Records method outcomes, including cache hits. Never copies upstream error bodies. */
export function track<T extends object>(client:T,source:string,report:SourceReport):T {
  return new Proxy(client,{get(target,key){
    const value=Reflect.get(target,key);
    if(typeof value!=='function')return value;
    return async(...args:unknown[])=>{
      try {
        const result=await Reflect.apply(value,target,args);
        if(!report.sources_used.includes(source))report.sources_used.push(source);
        return result;
      }catch(error){
        const reason=failureReason(error);
        if(!report.sources_skipped.some(s=>s.source===source && s.reason===reason))report.sources_skipped.push({source,reason});
        throw error;
      }
    };
  }});
}
