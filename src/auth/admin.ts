import type { AppEnv } from '../env';
import { constantTimeEqual } from './crypto';
import { pairingStore } from './pairing-store';
export const json = (data: unknown, status=200): Response => Response.json(data, {status, headers:{'cache-control':'no-store'}});
export async function admin(req: Request, env: AppEnv): Promise<Response> {
  if (!env.MGMT_TOKEN) return json({error:'Management token not configured'},503);
  const auth=req.headers.get('authorization') ?? '';
  if (!auth.startsWith('Bearer ') || !(await constantTimeEqual(auth.slice(7),env.MGMT_TOKEN))) return json({error:'Unauthorized'},401);
  const path=new URL(req.url).pathname;
  const store=pairingStore(env);
  if(path==='/admin/pair' && req.method==='POST') return json({...await store.create(),endpoint:`${env.PUBLIC_URL}/mcp`});
  if(path==='/admin/clients' && req.method==='GET') return json({clients:await store.clients()});
  if(path==='/admin/revoke' && req.method==='POST') {
    const body=await req.json() as {id?:unknown};
    if(typeof body.id!=='string' || !body.id) return json({error:'Client id required'},400);
    // Immediate access denial also protects against eventual consistency in OAuth KV.
    await store.revoke(body.id);
    await env.OAUTH_PROVIDER!.deleteClient(body.id);
    return json({revoked:body.id});
  }
  if(path==='/admin/status' && req.method==='GET') return json({endpoint:`${env.PUBLIC_URL}/mcp`,sources:{s2:env.S2_API_KEY?'keyed':'slow',openalex:env.OPENALEX_API_KEY?'keyed':'keyless'},openalex_quota:null});
  return json({error:'Not found'},404);
}
