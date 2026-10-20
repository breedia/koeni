/* KOESELL v0.5: direct messaging, report intake and account restrictions. */
(() => {
  'use strict';
  const api=()=>window.KOENI_DEMO_API, auth=()=>window.KOENI_AUTH;
  const sb=()=>auth()?.getClient?.(), who=()=>auth()?.getUser?.();
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const note='<div class="hintbox">メッセージは不正利用の兆候を自動検知し、通報や不正の疑いがある場合に運営が内容を確認することがあります。本人へのなりすまし・無断の声の複製・詐欺は禁止です。自動判定だけでBANはしません。購入・決済はまだ利用できません。</div>';
  async function active(){
    if(!sb()||!who()){auth()?.open?.();return false}
    const {data,error}=await sb().rpc('koesell_my_ban_status');
    if(error){api().toast('アカウントの状態を確認できません');return false}
    if(data){api().toast('このアカウントは利用停止中です。新規投稿・メッセージ送信はできません');return false}
    return true;
  }
  async function start(listingId){
    if(!await active())return;
    const user=who();
    const {data:listing,error:readError}=await sb().from('voice_listings')
      .select('id,owner_id').eq('id',listingId).single();
    if(readError||!listing){api().toast('出品を見つけられませんでした');return}
    if(listing.owner_id===user.id){api().toast('自分自身には相談できません');return}
    let {data:t,error}=await sb().from('voice_threads').select('id')
      .eq('listing_id',listingId).eq('buyer_id',user.id).maybeSingle();
    if(error){api().toast('メッセージを開けませんでした');return}
    if(!t){
      const insert=await sb().from('voice_threads').insert({
        listing_id:listingId,buyer_id:user.id,seller_id:listing.owner_id
      }).select('id').single();
      if(insert.error){
        if(insert.error.code==='23505'){
          const retry=await sb().from('voice_threads').select('id').eq('listing_id',listingId)
            .eq('buyer_id',user.id).maybeSingle();t=retry.data;
        }
        if(!t){api().toast('相談を開始できませんでした');return}
      } else t=insert.data;
    }
    await thread(t.id);
  }
  async function inbox(){
    if(!sb()||!who()){auth()?.open?.();return}
    const {data,error}=await sb().from('voice_threads')
      .select('id,listing_id,buyer_id,seller_id,created_at,voice_listings(title)')
      .order('created_at',{ascending:false}).limit(50);
    if(error){console.warn('KOESELL inbox',error);api().toast('メッセージ一覧を開けませんでした');return}
    const items=(data||[]).map(t=>'<div class="mine"><div class="row-space"><b>'+
      esc(t.voice_listings?.title||'声についての相談')+'</b><button class="btn light sm" data-thread-id="'+esc(t.id)+'">開く</button></div>'+
      '<p>'+(t.buyer_id===who().id?'出品者との相談':'購入希望者との相談')+
      ' · '+esc(new Date(t.created_at).toLocaleDateString('ja-JP'))+'</p></div>').join('')||
      '<p class="muted">まだメッセージがありません。声の詳細から出品者へ相談できます。</p>';
    api().openModal('メッセージ',note+items,true);
    document.querySelectorAll('[data-thread-id]').forEach(b=>b.addEventListener('click',()=>thread(b.dataset.threadId)));
  }
  async function thread(id){
    if(!sb()||!who()){auth()?.open?.();return}
    const {data:conversation,error:te}=await sb().from('voice_threads')
      .select('id,buyer_id,seller_id').eq('id',id).single();
    if(te||!conversation){api().toast('会話を開けませんでした');return}
    const {data,error}=await sb().from('voice_messages')
      .select('id,thread_id,sender_id,body,created_at')
      .eq('thread_id',id).order('created_at',{ascending:true}).limit(100);
    if(error){console.warn('KOESELL messages',error);api().toast('メッセージを取得できませんでした');return}
    const msgs=(data||[]).map(m=>{
      const mine=m.sender_id===who().id;
      return '<div class="mine" style="border-left:3px solid '+(mine?'#6f52e9':'#999')+';margin:8px 0"><div class="row-space"><b>'+
        (mine?'自分':'相手')+'</b><span class="request-meta">'+esc(new Date(m.created_at).toLocaleString('ja-JP'))+'</span></div>'+
        '<p style="white-space:pre-wrap;overflow-wrap:anywhere">'+esc(m.body)+'</p>'+
        (mine?'':'<button type="button" class="btn light sm" data-message-report="'+esc(m.id)+'">通報</button>')+'</div>'
    }).join('')||'<p class="muted">最初のメッセージを送れます。</p>';
    api().openModal('声について相談',note+
      '<div style="max-height:42vh;overflow:auto">'+msgs+'</div>'+
      '<div class="row-space" style="margin:12px 0"><button class="btn light sm" type="button" id="chatReload">再読み込み</button>'+
      '<button class="btn light sm" type="button" id="chatBack">一覧へ戻る</button></div>'+
      '<form id="chatSend"><div class="field"><label>メッセージ（最大1000文字）</label>'+
      '<textarea name="body" maxlength="1000" required placeholder="相談内容を入力。認証コードや個人情報は送らないでください。"></textarea></div>'+
      '<button class="btn primary" type="submit">送信</button></form>',true);
    document.getElementById('chatReload')?.addEventListener('click',()=>thread(id));
    document.getElementById('chatBack')?.addEventListener('click',inbox);
    document.querySelectorAll('[data-message-report]').forEach(b=>b.addEventListener('click',()=>report(b.dataset.messageReport)));
    document.getElementById('chatSend')?.addEventListener('submit',async e=>{
      e.preventDefault();
      const form=e.currentTarget,button=form.querySelector('[type=submit]');
      const body=String(new FormData(form).get('body')||'').trim();
      if(!body || body.length>1000){api().toast('メッセージは1～1000文字で入力してください');return}
      if(!await active())return;
      button.disabled=true;
      const {error}=await sb().from('voice_messages').insert({thread_id:id,sender_id:who().id,body});
      if(error){console.warn('KOESELL chat send',error);button.disabled=false;api().toast('送信できませんでした。連続送信制限などを確認してください');return}
      await thread(id);
    });
  }
  function report(id){
    if(!who()){auth()?.open?.();return}
    api().openModal('メッセージを通報',
      '<p class="muted">不審なメッセージを運営に報告します。</p>'+
      '<form id="reportChat"><div class="field"><label>理由</label><select name="reason">'+
      '<option value="impersonation">なりすまし・音声の無断複製</option><option value="fraud">詐欺・不審な金銭要求</option>'+
      '<option value="harassment">嫌がらせ</option><option value="other">その他</option></select></div>'+
      '<div class="field"><label>補足（任意）</label><textarea maxlength="500" name="details"></textarea></div>'+
      '<button class="btn primary" type="submit">通報する</button></form>');
    document.getElementById('reportChat')?.addEventListener('submit',async e=>{
      e.preventDefault();
      const form=e.currentTarget,button=form.querySelector('[type=submit]'),fd=new FormData(form);
      button.disabled=true;
      const {error}=await sb().from('voice_message_reports').insert({
        message_id:id,reporter_id:who().id,reason:String(fd.get('reason')),
        details:String(fd.get('details')||'').trim()
      });
      if(error){button.disabled=false;api().toast(error.code==='23505'?'すでに通報済みです':'通報できませんでした');return}
      api().closeModal();api().toast('通報を受け付けました');
    });
  }
  window.KOESELL_MESSAGES={active,start,inbox,thread,report};
})();