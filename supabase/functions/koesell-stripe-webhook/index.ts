// KOESELL Stripe webhook: a browser redirect never marks an order paid.
// Stripe-Signature is verified over the original raw body before any DB writes.
import { createClient } from "npm:@supabase/supabase-js@2";
const env=(key:string)=>Deno.env.get(key)||"";
function adminKey(){
  if(env("SUPABASE_SERVICE_ROLE_KEY"))return env("SUPABASE_SERVICE_ROLE_KEY");
  try{return JSON.parse(env("SUPABASE_SECRET_KEYS"))?.default||""}catch{return ""}
}
const response=(obj:unknown,status=200)=>new Response(JSON.stringify(obj),{
  status,headers:{"Content-Type":"application/json","Cache-Control":"no-store"}
});
function sameHex(a:string,b:string){
  if(a.length!==b.length)return false;
  let diff=0;
  for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);
  return diff===0;
}
async function verify(raw:string,header:string|null,secret:string){
  if(!secret||!header)return false;
  const fields=header.split(",").map(x=>x.trim());
  const timestamp=fields.find(x=>x.startsWith("t="))?.slice(2)||"";
  const signatures=fields.filter(x=>x.startsWith("v1=")).map(x=>x.slice(3));
  const numeric=Number(timestamp);
  if(!Number.isInteger(numeric)||Math.abs(Date.now()/1000-numeric)>300||!signatures.length)return false;
  const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),
    {name:"HMAC",hash:"SHA-256"},false,["sign"]);
  const signature=new Uint8Array(await crypto.subtle.sign("HMAC",key,
    new TextEncoder().encode(timestamp+"."+raw)));
  const expected=Array.from(signature).map(v=>v.toString(16).padStart(2,"0")).join("");
  return signatures.some(sig=>sameHex(sig,expected));
}
Deno.serve(async (req:Request)=>{
  if(req.method!=="POST")return response({error:"method_not_allowed"},405);
  const whsec=env("STRIPE_WEBHOOK_SECRET");
  const key=adminKey(),url=env("SUPABASE_URL");
  if(!whsec||!key||!url)return response({error:"not_configured"},503);
  const raw=await req.text();
  if(!await verify(raw,req.headers.get("stripe-signature"),whsec))
    return response({error:"invalid_signature"},400);
  const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  try{
    const event=JSON.parse(raw);
    const obj=event?.data?.object||{};
    const type=String(event?.type||"");
    if(type==="checkout.session.completed"||type==="checkout.session.async_payment_succeeded"){
      if(obj.mode!=="payment"||obj.payment_status!=="paid")return response({received:true});
      const id=String(obj.client_reference_id||""),fromMetadata=String(obj.metadata?.order_id||"");
      if(!id||id!==fromMetadata)return response({error:"order_ref_mismatch"},400);
      const {data:order,error}=await db.from("voice_orders")
        .select("id,status,amount_yen,stripe_checkout_session_id")
        .eq("id",id).maybeSingle();
      if(error)throw error;
      if(!order)return response({error:"order_missing"},500);
      if(order.stripe_checkout_session_id!==obj.id ||
          Number(order.amount_yen)!==Number(obj.amount_total) ||
          String(obj.currency).toLowerCase()!=="jpy")
        return response({error:"payment_mismatch"},400);
      if(order.status==="pending"){
        const intent=typeof obj.payment_intent==="string"?obj.payment_intent:obj.payment_intent?.id;
        if(!intent)return response({error:"intent_missing"},500);
        const updated=await db.from("voice_orders")
          .update({status:"paid",paid_at:new Date().toISOString(),
            stripe_payment_intent_id:intent})
          .eq("id",id).eq("status","pending");
        if(updated.error)throw updated.error;
      }
    }else if(type==="checkout.session.expired"){
      if(obj.id){
        const update=await db.from("voice_orders").update({status:"expired"})
          .eq("stripe_checkout_session_id",obj.id).eq("status","pending");
        if(update.error)throw update.error;
      }
    }else if(type==="charge.refunded"){
      const intent=typeof obj.payment_intent==="string"?obj.payment_intent:obj.payment_intent?.id;
      if(intent){
        const {data:order,error}=await db.from("voice_orders")
          .select("id,status").eq("stripe_payment_intent_id",intent).maybeSingle();
        if(error)throw error;
        if(order&&["paid","partially_refunded"].includes(order.status)){
          const full=Number(obj.amount_refunded)>=Number(obj.amount);
          const result=await db.from("voice_orders").update({
            status:full?"refunded":"partially_refunded",
            refunded_at:full?new Date().toISOString():null
          }).eq("id",order.id).in("status",["paid","partially_refunded"]);
          if(result.error)throw result.error;
        }
      }
    }else if(type==="charge.dispute.created"){
      const intent=typeof obj.payment_intent==="string"?obj.payment_intent:obj.payment_intent?.id;
      if(intent){
        const result=await db.from("voice_orders").update({status:"disputed"})
          .eq("stripe_payment_intent_id",intent).eq("status","paid");
        if(result.error)throw result.error;
      }
    }
    return response({received:true});
  }catch(error){
    console.error("KOESELL Stripe webhook processing failed",
      error instanceof Error?error.message:"unknown");
    return response({error:"retry_later"},500);
  }
});