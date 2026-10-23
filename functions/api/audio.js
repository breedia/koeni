/* KOESELL v0.8 — Cloudflare Pages Function with a private R2 binding.
   Disabled by design until KOESELL_AUDIO binding and SUPABASE_SECRET_KEY encrypted secret are configured.
   Never expose R2 bucket public URL, service credentials, or unprotected master-audio keys.
*/
const SUPABASE_URL = 'https://tiyyxtbmaxtdsmmrdsjd.supabase.co';
const PUBLIC_KEY = 'sb_publishable_jlIbL7sH-Gzj55CMJS2CjQ_LDsTGuyf';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AUDIO_MIME = {
  mp3:'audio/mpeg',m4a:'audio/mp4',wav:'audio/wav',
  ogg:'audio/ogg',webm:'audio/webm',aac:'audio/aac',flac:'audio/flac'
};
const PREVIEW_PATH = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(mp3|m4a|wav|ogg|webm|aac|flac)$/i;
const MASTER_PATH = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(mp3|m4a|wav|ogg|webm|aac|flac)$/i;
const error = (code,status) => new Response(JSON.stringify({error:code}),{
  status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}
});
const json = (value,status=200) => new Response(JSON.stringify(value),{
  status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}
});
const serverSecret = (env) => env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
const active = (env) => Boolean(env.KOESELL_AUDIO && serverSecret(env));
// Supabase secret keys must be used from a backend with an explicit non-browser
// User-Agent. Never forward a browser's incoming headers to privileged fetches.
const privilegedHeaders = (secret,compat=false) => ({
  apikey:secret,
  'User-Agent':'KOESELL-R2-Backend/0.9',
  ...(secret.startsWith('eyJ')||compat?{Authorization:'Bearer '+secret}:{})
});
const safeQuery = (value) => encodeURIComponent(value);
function mimeOf(request){
  const ext=request.headers.get('x-file-extension')?.toLowerCase()||'';
  return {ext,mime:AUDIO_MIME[ext]};
}
async function supa(table,params,{jwt,secret,compat=false}={}){
  const headers={apikey:PUBLIC_KEY};
  if(jwt)headers.Authorization='Bearer '+jwt;
  if(secret)Object.assign(headers,privilegedHeaders(secret,compat));
  const response=await fetch(SUPABASE_URL+'/rest/v1/'+table+'?'+params,{headers});
  if(!response.ok)throw new Error('database_query_failed_'+response.status);
  return response.json();
}
async function supaInsert(table,data,secret,compat=false){
  const response=await fetch(SUPABASE_URL+'/rest/v1/'+table,{
    method:'POST',
    headers:{...privilegedHeaders(secret,compat),
      'Content-Type':'application/json',Prefer:'return=minimal'},
    body:JSON.stringify(data)
  });
  if(!response.ok)throw new Error('database_write_failed_'+response.status);
}
async function authUser(request){
  const match=request.headers.get('authorization')?.match(/^Bearer (.+)$/i);
  if(!match)return null;
  const jwt=match[1];
  const result=await fetch(SUPABASE_URL+'/auth/v1/user',{
    headers:{apikey:PUBLIC_KEY,Authorization:'Bearer '+jwt}
  });
  if(!result.ok)return null;
  const data=await result.json();
  if(!UUID.test(data.id||''))return null;
  // Check suspension through the user's authenticated RPC, not through
  // direct account_bans SELECT (this private table intentionally has no client grants).
  const banResponse=await fetch(SUPABASE_URL+'/rest/v1/rpc/koesell_my_ban_status',{
    method:'POST',
    headers:{apikey:PUBLIC_KEY,Authorization:'Bearer '+jwt,
      'Content-Type':'application/json'},
    body:'{}'
  });
  if(!banResponse.ok)throw new Error('ban_check_failed_'+banResponse.status);
  if(await banResponse.json()===true)return null;
  return {user:data,jwt};
}
async function privilegedAccess(env){
  const key=serverSecret(env);
  if(!key)return {ready:false,reason:'not_configured'};
  if(!key.startsWith('sb_secret_')&&!key.startsWith('eyJ'))
    return {ready:false,reason:'invalid_secret_type'};
  // Normal sb_secret_ requests use apikey alone. Retry the documented gateway
  // compatibility form with matching Authorization only if the first fails.
  // Never mark masterReady true unless actual service-level grants succeed.
  try{
    let lastStatus=0;
    for(const compat of (key.startsWith('sb_secret_')?[false,true]:[false])){
      const response=await fetch(SUPABASE_URL+'/rest/v1/account_bans?select=user_id&limit=0',{
        headers:privilegedHeaders(key,compat)
      });
      if(response.ok)return {ready:true,compat};
      lastStatus=response.status;
      if(response.status>=500)break;
    }
    return {ready:false,reason:lastStatus===401||lastStatus===403?'key_not_authorized':'key_probe_failed'};
  }catch{return {ready:false,reason:'connection_failed'}}
}
async function readAudio(bucket,key,request,master){
  const obj=await bucket.get(key,{
    range:request.headers.get('Range')?request.headers:undefined
  });
  if(!obj||!obj.body)return error('file_not_found',404);
  const headers=new Headers({
    'Content-Type':obj.httpMetadata?.contentType||'application/octet-stream',
    'Cache-Control':'private, no-store',
    'X-Content-Type-Options':'nosniff',
    'Accept-Ranges':'bytes',
    'Content-Disposition':master?'attachment; filename="koesell-audio"':'inline',
    'Vary':'Authorization'
  });
  if(obj.httpEtag)headers.set('ETag',obj.httpEtag);
  const range=obj.range;
  if(request.headers.has('Range')&&range&&Number.isInteger(range.offset)&&Number.isInteger(range.length)){
    headers.set('Content-Range', 'bytes '+range.offset+'-'+(range.offset+range.length-1)+'/'+obj.size);
    headers.set('Content-Length',String(range.length));
    return new Response(obj.body,{status:206,headers});
  }
  headers.set('Content-Length',String(obj.size));
  return new Response(obj.body,{status:200,headers});
}
export async function onRequest({request,env}){
  const url=new URL(request.url);
  const op=url.searchParams.get('op')||'';
  if(request.method==='GET'&&op==='status'){
    // "ready" covers customer previews; "masterReady" also requires a working
    // privileged server key for inserting private sale registrations.
    const master=active(env)?await privilegedAccess(env):{ready:false,reason:'not_configured'};
    return json({ready:active(env),masterReady:master.ready,
      ...(!master.ready?{masterError:master.reason}:{}),storage:'r2'});
  }
  if(!active(env))return error('r2_not_configured',503);
  if(!['GET','POST','DELETE'].includes(request.method))return error('method_not_allowed',405);
  if(request.method!=='GET' && request.headers.get('origin')!==url.origin)
    return error('origin_not_allowed',403);
  // The service-role key never leaves this Function or Cloudflare's encrypted Secrets.
  try{
    const bucket=env.KOESELL_AUDIO;
    if(request.method==='GET'&&op==='preview'){
      const path=url.searchParams.get('path')||'';
      if(!PREVIEW_PATH.test(path))return error('invalid_path',400);
      const listings=await supa('voice_listings',
        'select=id&preview_path=eq.'+safeQuery(path)+
        '&preview_storage=eq.r2&review_status=eq.approved&is_published=eq.true&limit=1');
      if(!listings.length)return error('not_found',404);
      return readAudio(bucket,'previews/'+path,request,false);
    }
    if(request.method==='GET'&&op==='master'){
      const orderId=url.searchParams.get('orderId')||'';
      if(!UUID.test(orderId))return error('invalid_order',400);
      const who=await authUser(request);
      if(!who)return error('login_required',401);
      const orders=await supa('voice_orders',
        'select=id,buyer_id,status,purchased_master_path,storage_backend'+
        '&id=eq.'+safeQuery(orderId)+'&buyer_id=eq.'+safeQuery(who.user.id)+
        '&status=eq.paid&storage_backend=eq.r2&limit=1',{jwt:who.jwt});
      if(!orders.length||!MASTER_PATH.test(orders[0].purchased_master_path))
        return error('not_downloadable',404);
      return readAudio(bucket,'masters/'+orders[0].purchased_master_path,request,true);
    }
    if(request.method==='POST'&&['upload-preview','upload-master'].includes(op)){
      const who=await authUser(request);
      if(!who)return error('login_required',401);
      const {ext,mime}=mimeOf(request);
      if(!mime)return error('unsupported_audio_format',415);
      const sizeLimit=op==='upload-preview'?10*1024*1024:25*1024*1024;
      const estimated=Number(request.headers.get('content-length')||0);
      if(estimated>sizeLimit)return error('file_too_large',413);
      const masterAccess=op==='upload-master'?await privilegedAccess(env):null;
      if(op==='upload-master'&&!masterAccess.ready)
        return error('private_master_registration_not_ready',503);
      const data=await request.arrayBuffer();
      if(data.byteLength<1||data.byteLength>sizeLimit)return error('invalid_file_size',413);
      let key,path;
      if(op==='upload-preview'){
        const listingCount=await supa('voice_listings',
          'select=id&owner_id=eq.'+safeQuery(who.user.id)+'&limit=31',{jwt:who.jwt});
        if(listingCount.length>=30)return error('listing_limit',429);
        const existing=await bucket.list({prefix:'previews/'+who.user.id+'/',limit:60});
        if(existing.truncated||existing.objects.length>=50)return error('upload_limit',429);
        path=who.user.id+'/'+crypto.randomUUID()+'.'+ext;
        key='previews/'+path;
      }else{
        const listingId=url.searchParams.get('listingId')||'';
        if(!UUID.test(listingId))return error('invalid_listing',400);
        const listings=await supa('voice_listings',
          'select=id&owner_id=eq.'+safeQuery(who.user.id)+
          '&id=eq.'+safeQuery(listingId)+
          '&listing_type=eq.stock&review_status=eq.approved&is_published=eq.true&limit=1',
          {jwt:who.jwt});
        if(!listings.length)return error('listing_not_available',403);
        const products=await supa('voice_products',
          'select=listing_id&listing_id=eq.'+safeQuery(listingId)+'&limit=1',{jwt:who.jwt});
        if(products.length)return error('master_already_registered',409);
        path=who.user.id+'/'+listingId+'/'+crypto.randomUUID()+'.'+ext;
        key='masters/'+path;
      }
      const saved=await bucket.put(key,data,{
        httpMetadata:{contentType:mime,cacheControl:'private, no-store'}
      });
      if(!saved)return error('upload_unavailable',503);
      if(op==='upload-preview')return json({path,storage:'r2'});
      try{
        const filename=decodeURIComponent(request.headers.get('x-original-filename')||'').slice(0,120)||'audio.'+ext;
        await supaInsert('voice_products',{
          listing_id:url.searchParams.get('listingId'),owner_id:who.user.id,
          master_path:path,original_filename:filename,file_size_bytes:data.byteLength,
          storage_backend:'r2'
        },serverSecret(env),masterAccess.compat);
        return json({path,storage:'r2'});
      }catch(e){
        await bucket.delete(key);
        throw e;
      }
    }
    if(request.method==='DELETE'&&['preview','master'].includes(op)){
      const who=await authUser(request);
      if(!who)return error('login_required',401);
      const path=url.searchParams.get('path')||'';
      const valid=op==='preview'?PREVIEW_PATH.test(path):MASTER_PATH.test(path);
      if(!valid||!path.startsWith(who.user.id+'/'))return error('forbidden',403);
      if(op==='master'){
        const service=await privilegedAccess(env);
        if(!service.ready)return error('private_master_delete_not_ready',503);
        const product=await supa('voice_products',
          'select=listing_id&master_path=eq.'+safeQuery(path)+'&limit=1',
          {secret:serverSecret(env),compat:service.compat});
        if(product.length)return error('master_still_registered',409);
        const orders=await supa('voice_orders',
          'select=id&purchased_master_path=eq.'+safeQuery(path)+'&limit=1',
          {secret:serverSecret(env),compat:service.compat});
        if(orders.length)return error('master_has_orders',409);
      }
      await bucket.delete((op==='preview'?'previews/':'masters/')+path);
      return json({deleted:true});
    }
    return error('not_found',404);
  }catch(e){
    console.error('KOESELL R2 request failed',e instanceof Error?e.message:'unknown');
    return error('storage_unavailable',503);
  }
}
