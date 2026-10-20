/* KOESELL v0.6 – role-gated moderation tool. No secret/service_role keys in this file. */
import {createClient} from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
const db=createClient('https://tiyyxtbmaxtdsmmrdsjd.supabase.co',
 'sb_publishable_jlIbL7sH-Gzj55CMJS2CjQ_LDsTGuyf',
 {auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=d=>d?new Date(d).toLocaleString('ja-JP'):'';
const uuid=v=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v||''))?String(v):'';
const panel=$('adminPanel');
let authorized=false;
function status(message){$('status').textContent=message;}
function emptyText(txt){return '<div class="empty">'+esc(txt)+'</div>';}
function btn(type,id,label,css){return uuid(id)?'<button class="'+(css||'light')+'" data-op="'+esc(type)+'" data-id="'+esc(id)+'">'+esc(label)+'</button>':'';}
function card(body,meta,actions){
 return '<article class="card"><div class="meta">'+esc(meta)+'</div><p>'+esc(body)+'</p>'+
  '<div class="actions">'+actions+'</div></article>';
}
function render(items,id,count,markup,label){
 const data=Array.isArray(items)?items:[];
 $(count).textContent=String(data.length);
 $(id).innerHTML=data.length?data.map(markup).join(''):emptyText(label);
}
async function load(){
 if(!authorized)return;
 $('refresh').disabled=true;
 status('運営権限を確認済み。通報データを読み込んでいます…');
 try{
  const {data,error}=await db.rpc('koesell_admin_queue');
  if(error)throw error;
  const d=data||{};
  render(d.message_reports,'messageReports','msgReportCount',m=>
    card(m.body,'メッセージ通報 | '+m.reason+' | '+fmt(m.created_at)+' | 通報内容: '+(m.details||'なし'),
      btn('ban',m.sender_id,'送信者をBAN','danger')+
      '<span class="code">送信者: '+esc(m.sender_id)+'</span>'),'メッセージへの通報はありません');
  render(d.flagged_messages,'flaggedMessages','flagCount',m=>
    card(m.body,'自動検知 | '+m.safety_flag+' | '+fmt(m.created_at),
      btn('ban',m.sender_id,'送信者をBAN','danger')+
      '<span class="code">送信者: '+esc(m.sender_id)+'</span>'),'不審なメッセージはまだ検知されていません');
  render(d.listing_reports,'listingReports','listingReportCount',m=>
    card(m.title,'出品通報 | '+m.reason+' | '+fmt(m.created_at)+' | 内容: '+(m.details||'なし'),
      btn('hide',m.listing_id,'この出品を非公開にする','secondary')+
      btn('ban',m.owner_id,'出品者をBAN','danger')),'出品への通報はありません');
  render(d.active_bans,'bans','banCount',m=>
    card(m.reason,'利用停止中 | '+fmt(m.banned_at)+' | '+m.user_id,
      btn('unban',m.user_id,'BAN解除','light')),'現在BANされているアカウントはありません');
  $('updatedAt').textContent='最終更新: '+fmt(new Date());
  status('運営専用データを表示しています。');
 }catch(e){console.error('KOESELL admin queue',e);status('通報データを取得できませんでした。権限と通信状態を確認してください。')}
 finally{$('refresh').disabled=false}
}
async function runOp(op,id){
 if(!authorized||!uuid(id))return;
 let rpc,args;
 if(op==='ban'){
  const reason=window.prompt('BANの理由を入力（3～500文字）。誤検知だけで停止しないでください。');
  if(!reason||reason.trim().length<3||reason.trim().length>500)return;
  if(!window.confirm('対象の新規投稿・メッセージ送信を禁止し、出品を非表示にします。続行しますか？'))return;
  rpc='koesell_admin_ban';args={target:id,explanation:reason.trim()};
 }else if(op==='unban'){
  if(!window.confirm('BANを解除しますか？ 公開出品が再び表示される可能性があります。'))return;
  rpc='koesell_admin_unban';args={target:id};
 }else if(op==='hide'){
  if(!window.confirm('この出品を一般公開から除外しますか？'))return;
  rpc='koesell_admin_hide_listing';args={target:id};
 }else return;
 status('更新しています…');
 const {data,error}=await db.rpc(rpc,args);
 if(error){console.error('KOESELL moderation operation',error);status('操作に失敗しました。内容と権限を確認してください。');return}
 status(data?'操作が完了しました。':'対象データが見つかりませんでした。');
 await load();
}
$('refresh').addEventListener('click',load);
panel.addEventListener('click',e=>{
 const b=e.target.closest('button[data-op]');if(b)runOp(b.dataset.op,b.dataset.id)
});
async function init(){
 try{
  const {data:{user},error}=await db.auth.getUser();
  if(error||!user){status('管理画面を使用するにはKOESELLへログインしてください。ログイン後にこのページを開き直してください。');return}
  const {data,error:accessError}=await db.rpc('koesell_admin_access');
  if(accessError)throw accessError;
  if(!data){status('このアカウントには運営管理権限がありません。管理者登録が必要です。');return}
  authorized=true;panel.hidden=false;await load();
 }catch(err){console.error('KOESELL admin access',err);status('管理権限を確認できませんでした。通信状態を確認してください。')}
}
init();