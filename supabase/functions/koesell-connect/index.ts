// KOESELL seller payout onboarding (Stripe Connect Express).
// Only Stripe hosts collect identity and bank details; KOESELL never receives them.
// Protected by a logged-in Supabase user JWT. Live creation is separately gated.
import { createClient } from "npm:@supabase/supabase-js@2";
const LEGACY_SITE="https://koeni.pages.dev";
const ALLOWED_SITES=new Set([LEGACY_SITE,"https://koesell.com","https://www.koesell.com"]);
const env=(k:string)=>Deno.env.get(k)||"";
function adminKey(){
  if(env("SUPABASE_SERVICE_ROLE_KEY"))return env("SUPABASE_SERVICE_ROLE_KEY");
  try{return JSON.parse(env("SUPABASE_SECRET_KEYS"))?.default||""}catch{return ""}
}
const cors=(origin:string|null)=>({
  "Access-Control-Allow-Origin":origin&&ALLOWED_SITES.has(origin)?origin:LEGACY_SITE,
  "Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods":"POST, OPTIONS",
  "Vary":"Origin",
});
const json=(body:unknown,status:number,origin:string|null)=>new Response(JSON.stringify(body),{
  status,headers:{...cors(origin),"Content-Type":"application/json","Cache-Control":"no-store",
    "X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer"}
});
async function stripe(path:string,key:string,params?:URLSearchParams,idempotency?:string){
  const headers:Record<string,string>={Authorization:"Bearer "+key};
  if(params)headers["Content-Type"]="application/x-www-form-urlencoded";
  if(idempotency)headers["Idempotency-Key"]=idempotency;
  const res=await fetch("https://api.stripe.com/v1/"+path,{
    method:params?"POST":"GET",headers,body:params?.toString(),
    signal:AbortSignal.timeout(12000)
  });
  const data=await res.json();
  if(!res.ok)throw Error("stripe_"+path.split("/")[0]+"_"+res.status);
  return data;
}
Deno.serve(async(req:Request)=>{
  const origin=req.headers.get("origin");
  const reply=(body:unknown,status=200)=>json(body,status,origin);
  if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors(origin)});
  if(req.method!=="POST")return reply({error:"method_not_allowed"},405);
  if(origin&&!ALLOWED_SITES.has(origin))return reply({error:"origin_not_allowed"},403);
  const token=req.headers.get("authorization")?.replace(/^Bearer\s+/i,"");
  if(!token)return reply({error:"login_required"},401);
  const url=env("SUPABASE_URL"),admin=adminKey();
  if(!url||!admin)return reply({error:"server_not_configured"},503);
  const db=createClient(url,admin,{auth:{persistSession:false,autoRefreshToken:false}});
  try{
    const {data:session,error:authError}=await db.auth.getUser(token);
    if(authError||!session?.user)return reply({error:"login_required"},401);
    const user=session.user;
    const body=await req.json().catch(()=>({}));
    const action=body?.action;
    if(action!=="status"&&action!=="onboard")return reply({error:"invalid_action"},400);
    // An authenticated banned user must not create/manage new payout accounts.
    const userDb=createClient(url,env("SUPABASE_ANON_KEY")||"sb_publishable_jlIbL7sH-Gzj55CMJS2CjQ_LDsTGuyf",{
      auth:{persistSession:false,autoRefreshToken:false},
      global:{headers:{Authorization:"Bearer "+token}}
    });
    const ban=await userDb.rpc("koesell_my_ban_status");
    if(ban.error)return reply({error:"account_check_unavailable"},503);
    if(ban.data===true)return reply({error:"account_suspended"},403);
    const key=env("STRIPE_SECRET_KEY");
    const isTest=key.startsWith("sk_test_");
    const isLive=key.startsWith("sk_live_");
    if(!isTest&&!isLive){
      return action==="status"?reply({configured:false,connected:false,ready:false})
        :reply({error:"stripe_not_configured"},503);
    }
    if(isLive&&env("KOESELL_ALLOW_LIVE_CONNECT")!=="yes"){
      return action==="status"?reply({configured:false,connected:false,ready:false,mode:"live"})
        :reply({error:"live_connect_disabled"},503);
    }
    const mode=isTest?"test":"live";
    const snapshot=await db.rpc("koesell_connect_get",{target_user_id:user.id});
    if(snapshot.error)throw snapshot.error;
    let accountId=typeof snapshot.data?.accountId==="string"?snapshot.data.accountId:"";
    if(accountId&&!/^acct_[a-zA-Z0-9]+$/.test(accountId))
      return reply({error:"seller_account_invalid"},503);
    if(!accountId&&action==="onboard"){
      const params=new URLSearchParams({
        type:"express",country:"JP",
        "capabilities[transfers][requested]":"true",
        "metadata[koesell_user_id]":user.id
      });
      if(user.email&&user.email_confirmed_at)params.set("email",user.email);
      const created=await stripe("accounts",key,params,"koesell-express-"+mode+"-"+user.id);
      if(!/^acct_[a-zA-Z0-9]+$/.test(created?.id||""))
        return reply({error:"seller_account_create_failed"},503);
      accountId=created.id;
      const saved=await db.rpc("koesell_connect_set",{
        target_user_id:user.id,target_account_id:accountId,
        target_payouts_enabled:false,target_details_submitted:false
      });
      if(saved.error)throw saved.error;
    }
    if(!accountId)return reply({configured:true,mode,connected:false,ready:false});
    const account=await stripe("accounts/"+accountId,key);
    if(account.id!==accountId)return reply({error:"seller_account_mismatch"},503);
    const transfersActive=account.capabilities?.transfers==="active";
    const ready=account.payouts_enabled===true&&transfersActive;
    const synced=await db.rpc("koesell_connect_set",{
      target_user_id:user.id,target_account_id:accountId,
      target_payouts_enabled:ready,target_details_submitted:account.details_submitted===true
    });
    if(synced.error)throw synced.error;
    if(action==="status"){
      return reply({
        configured:true,mode,connected:true,ready,
        payoutsEnabled:account.payouts_enabled===true,
        transfersActive,detailsSubmitted:account.details_submitted===true
      });
    }
    const site=origin&&ALLOWED_SITES.has(origin)?origin:LEGACY_SITE;
    const parameters=new URLSearchParams({
      account:accountId,type:"account_onboarding",
      refresh_url:site+"/?stripe_connect=refresh",
      return_url:site+"/?stripe_connect=return"
    });
    const link=await stripe("account_links",key,parameters);
    const redirect=new URL(link?.url||"");
    if(redirect.protocol!=="https:"||redirect.hostname!=="connect.stripe.com")
      return reply({error:"invalid_stripe_link"},503);
    return reply({url:link.url,mode});
  }catch(e){
    console.error("KOESELL Connect error",e instanceof Error?e.message:"unknown");
    return reply({error:"connect_unavailable"},503);
  }
});
