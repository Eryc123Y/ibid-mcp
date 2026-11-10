import { AuthorizationError, CimdFetchError } from '@cloudflare/workers-oauth-provider';
import type { AppEnv } from '../env';
import { admin } from './admin';
import { pairingStore } from './pairing-store';
import { consentPage, messagePage } from './pages';

async function authorize(req: Request, env: AppEnv): Promise<Response> {
  if (!env.CONSENT_SECRET || env.CONSENT_SECRET.length < 32 || !env.OAUTH_PROVIDER) return messagePage('Not configured','A consent secret and OAuth provider are required.',503);
  const oauth=env.OAUTH_PROVIDER;
  if(req.method==='GET') {
    const request=await oauth.parseAuthRequest(req);
    const details=await oauth.describeConsent(request);
    const consent=await oauth.beginConsent(request);
    consent.headers.set('content-type','text/html; charset=utf-8');
    consent.headers.set('cache-control','no-store');
    return new Response(consentPage(details,consent.handle),{headers:consent.headers});
  }
  if(req.method!=='POST') return new Response('Method not allowed',{status:405});
  const form=await req.formData();const handle=String(form.get('handle') ?? '');
  if(form.get('decision')!=='approve') {
    const denied=await oauth.denyConsent(req,handle);
    return new Response(null,{status:302,headers:denied.headers});
  }
  // Validate browser binding before using a pairing attempt. Never bypass pairing via a cookie.
  const approved=await oauth.approveConsent(req,handle,{remember:{secret:env.CONSENT_SECRET,subject:'owner'}});
  const authorizationId=await pairingStore(env).consume(String(form.get('code') ?? ''),approved.request.clientId);
  if(!authorizationId) return messagePage('Pairing failed','Invalid or expired code. Restart authorization from your connector and try again.',403);
  const {redirectTo}=await oauth.completeAuthorization({request:approved.request,userId:'owner',metadata:{clientId:approved.request.clientId},scope:approved.request.scope,props:{authorizationId}});
  approved.headers.set('Location',redirectTo);
  approved.headers.set('cache-control','no-store');
  return new Response(null,{status:302,headers:approved.headers});
}
export const authHandler: {fetch: (req: Request, env: AppEnv, ctx: ExecutionContext) => Promise<Response>} = {
  async fetch(req,env) {
    try {
      const path=new URL(req.url).pathname;
      if(path.startsWith('/admin/')) return await admin(req as Request,env);
      if(path==='/authorize') return await authorize(req as Request,env);
      if(path==='/' && req.method==='GET') return new Response(`LitScout MCP: ${env.PUBLIC_URL}/mcp`);
      return new Response('Not found',{status:404});
    } catch(error) {
      if(error instanceof AuthorizationError && error.redirectTo) return Response.redirect(error.redirectTo,302);
      if(error instanceof CimdFetchError) return messagePage('Authorization failed','Client metadata could not be verified.',400);
      return messagePage('Request failed','Invalid request or expired browser session; start again from your connector.',400);
    }
  },
};
