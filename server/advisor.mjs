import {need} from '../src/domain.mjs';
import {advisorContext,advisorJSON,advisorStillActive,handleAdvisorAccounts,handleAdvisorAuth} from './advisor-auth.mjs';
import {handleAdvisorFinance} from './advisor-finance.mjs';

export async function handleAdvisor(env,request){
  const path=new URL(request.url).pathname;
  if(path!=='/kanzlei'&&!path.startsWith('/api/advisor/'))return null;
  if(path==='/kanzlei'){
    need(request.method==='GET','Methode nicht erlaubt.',405);
    return env.ASSETS.fetch(new Request(new URL('/advisor.html',env.PANEL_ORIGIN)));
  }
  const auth=await handleAdvisorAuth(env,request);if(auth)return auth;
  const context=await advisorContext(env,request);need(context,'Bitte im Kanzleizugang anmelden.',401);
  let response;
  if(path==='/api/advisor/session'&&request.method==='GET')response=advisorJSON({isOwner:context.isOwner,company:context.company,email:context.email});
  else if(path==='/api/advisor/accounts')response=await handleAdvisorAccounts(env,request,context);
  else response=await handleAdvisorFinance(env,request,context);
  await advisorStillActive(env,context);
  return response;
}
