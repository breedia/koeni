/* KOESELL v0.7: stock masters and buyer library. Payments intentionally disabled. */
(() => {
  'use strict';
  const api = () => window.KOENI_DEMO_API;
  const auth = () => window.KOENI_AUTH;
  const db = () => auth()?.getClient?.();
  const me = () => auth()?.getUser?.();
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const MASTERS = 'koesell-masters';
  const MB = 25 * 1024 * 1024;
  const accept = {mp3:'audio/mpeg',m4a:'audio/mp4',wav:'audio/wav',ogg:'audio/ogg',webm:'audio/webm',aac:'audio/aac',flac:'audio/flac'};
  function loggedIn(){
    if(db() && me())return true;
    api()?.toast('ログインしてください');
    auth()?.open?.();
    return false;
  }
  async function uploadMaster(listingId){
    if(!loggedIn())return;
    if(window.KOESELL_MESSAGES && !await window.KOESELL_MESSAGES.active())return;
    const uid=me().id;
    const {data:listing,error}=await db().from('voice_listings')
      .select('id,owner_id,title,listing_type,review_status').eq('id',listingId).single();
    if(error||!listing||listing.owner_id!==uid){api().toast('自分の出品だけ登録できます');return}
    if(listing.listing_type!=='stock'){api().toast('販売本編は既製音声の出品にのみ登録できます');return}
    if(listing.review_status!=='approved'){api().toast('非公開の出品には登録できません');return}
    const old=await db().from('voice_products').select('listing_id,original_filename')
      .eq('listing_id',listingId).maybeSingle();
    if(old.error){api().toast('登録状況を確認できませんでした');return}
    if(old.data){
      api().openModal('販売本編の登録状況',
        '<p><b>'+esc(listing.title)+'</b></p><div class="hintbox">本編は既に非公開ストレージへ登録されています。購入者の受取ファイルが途中で変わらないよう、この試作段階では差し替えできません。</div>'+
        '<p>登録済み: '+esc(old.data.original_filename)+'</p>');
      return;
    }
    api().openModal('販売本編を登録',
      '<div class="hintbox"><b>一般公開されません。</b>試聴用音声とは別の、購入者に納品する完成音声を登録します。最大25MBです。決済機能が完成するまでは購入者へ販売されません。自分が権利を持つ音声だけ登録してください。</div>'+
      '<p class="muted">対象の出品: '+esc(listing.title)+'</p>'+
      '<form id="masterUploadForm"><div class="field"><label>販売する音声ファイル*</label>'+
      '<input type="file" name="master" required accept=".mp3,.m4a,.wav,.ogg,.webm,.aac,.flac">'+
      '<span class="help">MP3・M4A・WAVなど。アップロードが完了するまで画面を閉じないでください。</span></div>'+
      '<label class="check"><input type="checkbox" required name="rightToSell"><span>納品音声について販売・商用利用の許諾に必要な権利を持っています。</span></label>'+
      '<button class="btn primary" type="submit" style="width:100%">非公開で本編を登録する</button></form>',true);
    document.getElementById('masterUploadForm')?.addEventListener('submit',async e=>{
      e.preventDefault();
      const form=e.currentTarget,button=form.querySelector('[type=submit]');
      if(!form.reportValidity())return;
      const file=form.querySelector('[name=master]')?.files?.[0];
      const ext=String(file?.name||'').split('.').pop().toLowerCase();
      const mime=accept[ext];
      if(!file||!mime||file.size===0||file.size>MB){
        api().toast('対応音声形式・25MB以内か確認してください');return;
      }
      button.disabled=true;button.textContent='非公開でアップロード中…';
      const path=uid+'/'+listingId+'/'+crypto.randomUUID()+'.'+ext;
      let uploaded=false;
      try{
        const storage=await db().storage.from(MASTERS)
          .upload(path,file,{contentType:mime,upsert:false,cacheControl:'0'});
        if(storage.error)throw storage.error;
        uploaded=true;
        const {error:insertError}=await db().from('voice_products').insert({
          listing_id:listingId,owner_id:uid,master_path:path,
          original_filename:String(file.name).slice(0,120),file_size_bytes:file.size
        });
        if(insertError)throw insertError;
        api().closeModal();
        api().toast('販売本編を非公開で登録しました。決済接続までは販売されません');
        api().showMyListings();
      }catch(err){
        console.warn('KOESELL master upload',err);
        if(uploaded)await db().storage.from(MASTERS).remove([path]);
        api().toast('登録できませんでした。通信状況や重複登録を確認してください');
        button.disabled=false;button.textContent='非公開で本編を登録する';
      }
    });
  }
  async function openOrders(){
    if(!loggedIn())return;
    const {data,error}=await db().from('voice_orders')
      .select('id,listing_id,buyer_id,seller_id,status,amount_yen,purchase_license,created_at,paid_at')
      .order('created_at',{ascending:false}).limit(60);
    if(error){console.warn('KOESELL orders load',error);api().toast('購入履歴を取得できませんでした');return}
    const owned=(data||[]).filter(o=>o.buyer_id===me().id);
    const sales=(data||[]).filter(o=>o.seller_id===me().id);
    const labels={pending:'決済確認待ち',paid:'購入済み',payment_failed:'決済失敗',expired:'期限切れ',refunded:'返金済み',partially_refunded:'一部返金',disputed:'異議申立中'};
    const item=o=>'<div class="mine"><div class="row-space"><b>'+
      esc(new Date(o.created_at).toLocaleDateString('ja-JP'))+' · '+Number(o.amount_yen).toLocaleString('ja-JP')+'円</b>'+
      '<span class="pill">'+esc(labels[o.status]||o.status)+'</span></div>'+
      '<p>'+esc(o.purchase_license)+'</p>'+
      (o.buyer_id===me().id&&o.status==='paid'?
        '<button type="button" class="btn primary sm" data-download-order="'+esc(o.id)+'">購入済み音声を受け取る</button>':'')+
      '</div>';
    api().openModal('購入・販売履歴',
      '<div class="hintbox">本物の決済履歴だけを表示します。試作版の購入デモは含まれません。支払済みの音声だけダウンロードできます。</div>'+
      '<h3>自分の購入</h3>'+(owned.length?owned.map(item).join(''):'<p class="muted">購入履歴はありません。</p>')+
      '<h3 style="margin-top:20px">自分の販売</h3>'+(sales.length?sales.map(item).join(''):'<p class="muted">販売履歴はありません。</p>'),true);
    document.querySelectorAll('[data-download-order]').forEach(b=>b.addEventListener('click',()=>download(b.dataset.downloadOrder)));
  }
  async function download(orderId){
    if(!loggedIn())return;
    const button=document.querySelector('[data-download-order="'+CSS.escape(orderId)+'"]');
    if(button){button.disabled=true;button.textContent='確認中…'}
    try{
      const {data,error}=await db().functions.invoke('koesell-delivery',{body:{orderId}});
      if(error||!data?.url)throw error||Error(data?.error||'download_unavailable');
      api().openModal('購入済み音声の受け取り',
        '<div class="hintbox">購入を確認しました。安全のためダウンロードリンクは60秒で期限が切れます。期限が切れた場合は購入履歴から再発行できます。</div>'+
        '<p><a class="btn primary" target="_blank" rel="noopener noreferrer" href="'+esc(data.url)+'">音声ファイルを開く・保存する →</a></p>',true);
    }catch(err){
      console.warn('KOESELL delivery',err);
      api().toast('購入状態を確認できませんでした。再ログイン後にお試しください');
      if(button){button.disabled=false;button.textContent='購入済み音声を受け取る'}
    }
  }
  async function checkout(listingId){
    if(!loggedIn())return;
    const {data,error}=await db().from('voice_products')
      .select('listing_id').eq('listing_id',listingId).maybeSingle();
    if(error){api().toast('販売状況を取得できませんでした');return}
    api().openModal('購入について',
      '<div class="hintbox"><b>決済準備中</b>：現在、Stripe Connectによる出品者への支払い・返金・本番決済を実装しています。まだ代金の請求は発生しません。</div>'+
      '<p>'+(data?'販売本編は登録済みです。決済の準備が整い次第、購入できるようになります。':'この出品の販売本編はまだ登録されていません。')+'</p>'+
      '<p class="muted">サイト外で直接お金を振り込むよう求められた場合は応じないでください。</p>');
  }
  window.KOESELL_SALES={uploadMaster,openOrders,checkout};
})();