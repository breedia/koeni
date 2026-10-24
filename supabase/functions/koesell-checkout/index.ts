// KOESELL Stripe Checkout (stock-only).
// Disabled until commerce_settings.payments_enabled is explicitly enabled.
import { createClient } from "npm:@supabase/supabase-js@2";
const LEGACY_SITE = "https://koeni.pages.dev";
const ALLOWED_SITES = new Set([LEGACY_SITE,"https://koesell.com","https://www.koesell.com"]);
const cors = (origin: string | null) => ({
  // Never reflect an arbitrary Origin into the response.
  "Access-Control-Allow-Origin": origin && ALLOWED_SITES.has(origin) ? origin : LEGACY_SITE,
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
});
const json = (body: unknown, status = 200, origin: string | null = null) => new Response(JSON.stringify(body),{
  status,headers:{...cors(origin),"Content-Type":"application/json","Cache-Control":"no-store"}
});
const env=(k:string)=>Deno.env.get(k)||"";
function serviceKey(){
  if(env("SUPABASE_SERVICE_ROLE_KEY"))return env("SUPABASE_SERVICE_ROLE_KEY");
  try{return JSON.parse(env("SUPABASE_SECRET_KEYS"))?.default||""}catch{return ""}
}
async function stripeGet(path:string,key:string){
  const r=await fetch("https://api.stripe.com/v1/"+path,{
    headers:{Authorization:"Bearer "+key}});
  const obj=await r.json();
  if(!r.ok)throw Error("stripe_get_failed_"+r.status);
  return obj;
}
async function stripePost(path:string,key:string,params:URLSearchParams,idempotency:string){
  const r=await fetch("https://api.stripe.com/v1/"+path,{
    method:"POST",
    headers:{"Authorization":"Bearer "+key,"Content-Type":"application/x-www-form-urlencoded","Idempotency-Key":idempotency},
    body:params.toString()
  });
  const obj=await r.json();
  if(!r.ok)throw Error("stripe_post_failed_"+r.status);
  return obj;
}
Deno.serve(async (req:Request)=>{
  const origin=req.headers.get("origin");
  const reply=(body: unknown,status=200)=>json(body,status,origin);
  if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors(origin)});
  if(req.method!=="POST")return reply({error:"method_not_allowed"},405);
  if(origin&&!ALLOWED_SITES.has(origin))return reply({error:"origin_not_allowed"},403);
  const successSite=origin&&ALLOWED_SITES.has(origin)?origin:LEGACY_SITE;
  const token=req.headers.get("authorization")?.replace(/^Bearer\s+/i,"");
  if(!token)return reply({error:"login_required"},401);
  const adminKey=serviceKey(),baseUrl=env("SUPABASE_URL");
  if(!adminKey||!baseUrl)return reply({error:"not_configured"},503);
  const db=createClient(baseUrl,adminKey,{auth:{autoRefreshToken:false,persistSession:false}});
  try{
    const {data:session,error:authError}=await db.auth.getUser(token);
    if(authError||!session?.user)return reply({error:"login_required"},401);
    const data=await req.json();
    const listingId=typeof data?.listingId==="string"?data.listingId:"";
    if(!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(listingId))return reply({error:"invalid_listing"},400);
    const {data:product,error:snapshotError}=await db.rpc("koesell_checkout_snapshot",{
      target_listing_id:listingId,purchasing_user_id:session.user.id
    });
    if(snapshotError)throw snapshotError;
    if(!product?.ready)return reply({error:"payments_not_available"},503);
    // Reject forged/broken R2 catalog records before starting a payment.
    // Only Cloudflare's private R2 binding can check the actual stored object.
    if(product.storage_backend==="r2"){
      // Canonical Pages hostname remains available even while the custom zone is pending.
      const verifyUrl=LEGACY_SITE+"/api/audio?op=verify-product&listingId="+encodeURIComponent(listingId);
      const verification=await fetch(verifyUrl,{
        headers:{Authorization:"Bearer "+token},
        signal:AbortSignal.timeout(8000)
      });
      if(!verification.ok)return reply({error:"master_file_unavailable"},409);
      const check=await verification.json().catch(()=>({exists:false}));
      if(!check.exists||check.path!==product.master_path)
        return reply({error:"master_file_unavailable"},409);
    }
    const key=env("STRIPE_SECRET_KEY");
    if(!key)return reply({error:"stripe_not_configured"},503);
    if(!key.startsWith("sk_test_")&&env("KOESELL_ALLOW_LIVE_PAYMENTS")!=="yes")
      return reply({error:"live_payments_disabled"},503);
    const price=Number(product.price_yen),feeBps=Number(product.fee_bps);
    if(!Number.isInteger(price)||price<100||price>100000||!Number.isInteger(feeBps)||feeBps<0||feeBps>3000)
      return reply({error:"invalid_price_settings"},503);
    if(!/^acct_[\w]+$/.test(product.stripe_account||""))return reply({error:"seller_not_ready"},403);
    const acct=await stripeGet("accounts/"+product.stripe_account,key);
    if(!acct?.payouts_enabled||acct?.capabilities?.transfers!=="active")
      return reply({error:"seller_not_ready"},403);
    const since=new Date(Date.now()-3600000).toISOString();
    const recent=await db.from("voice_orders").select("id",{count:"exact",head:true})
      .eq("buyer_id",session.user.id).gte("created_at",since);
    if(recent.error)throw recent.error;
    if((recent.count||0)>=12)return reply({error:"rate_limited"},429);
    const fee=Math.round(price*feeBps/10000);
    const orderId=crypto.randomUUID();
    const orderRecord={
      id:orderId,buyer_id:session.user.id,seller_id:product.seller_id,
      listing_id:product.listing_id,amount_yen:price,platform_fee_yen:fee,
      purchased_master_path:product.master_path,purchase_license:product.license,
      storage_backend:product.storage_backend||'supabase',
      stripe_connected_account_id:product.stripe_account,status:"pending"
    };
    const inserted=await db.from("voice_orders").insert(orderRecord);
    if(inserted.error)throw inserted.error;
    const params=new URLSearchParams();
    const fields:{
      [key:string]:string
    }={
      mode:"payment",
      // Stripe determines eligible methods from Dashboard, currency, account and Connect capabilities.
      // PayPay must NOT be advertised until Stripe approves Connect use for this platform.
      "line_items[0][quantity]":"1",
      "line_items[0][price_data][currency]":"jpy",
      "line_items[0][price_data][unit_amount]":String(price),
      "line_items[0][price_data][product_data][name]":String(product.title).slice(0,120),
      "payment_intent_data[transfer_data][destination]":product.stripe_account,
      "client_reference_id":orderId,
      "metadata[order_id]":orderId,
      "success_url":successSite+"/?checkout=success&session_id={CHECKOUT_SESSION_ID}",
      "cancel_url":successSite+"/?checkout=cancel"
    };
    if(fee>0)fields["payment_intent_data[application_fee_amount]"]=String(fee);
    for(const [k,v]of Object.entries(fields))params.set(k,v);
    try{
      const checkout=await stripePost("checkout/sessions",key,params,"koesell-checkout-"+orderId);
      if(!checkout.id||!checkout.url)throw Error("bad_checkout_response");
      const update=await db.from("voice_orders")
        .update({stripe_checkout_session_id:checkout.id})
        .eq("id",orderId).eq("status","pending");
      if(update.error)throw update.error;
      return reply({url:checkout.url,orderId});
    }catch(e){
      await db.from("voice_orders").update({status:"payment_failed"})
        .eq("id",orderId).eq("status","pending");
      throw e;
    }
  }catch(e){
    console.error("KOESELL checkout server error",e instanceof Error?e.message:"unknown");
    return reply({error:"checkout_unavailable"},503);
  }
});