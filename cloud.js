/* KOESELL v0.5: instant-publication previews, server-enforced bans. */
(() => {
  'use strict';
  const BUCKET = 'koeni-previews';
  const MB = 10 * 1024 * 1024;
  const acceptable = {
    mp3:'audio/mpeg', m4a:'audio/mp4', wav:'audio/wav',
    ogg:'audio/ogg', webm:'audio/webm', aac:'audio/aac', flac:'audio/flac',
    '3gp':'audio/3gpp', '3g2':'audio/3gpp2'
  };
  let generation = 0;
  let favoriteGeneration = 0;
  const api = () => window.KOENI_DEMO_API;
  const auth = () => window.KOENI_AUTH;
  const client = () => auth()?.getClient?.();
  const user = () => auth()?.getUser?.();
  const esc = s => String(s ?? '').replace(/[&<>"']/g, ch =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const r2Exts = new Set(['mp3','m4a','wav','ogg','webm','aac','flac']);
  async function r2Ready() {
    try {
      const r=await fetch('/api/audio?op=status',{cache:'no-store'});
      return r.ok && (await r.json()).ready===true;
    }catch {return false;}
  }
  async function r2Request(op,path,method='DELETE') {
    const {data}=await client().auth.getSession();
    if(!data.session?.access_token)throw new Error('ログインを確認できません');
    const r=await fetch('/api/audio?op='+encodeURIComponent(op)+'&path='+encodeURIComponent(path),{
      method,headers:{Authorization:'Bearer '+data.session.access_token}
    });
    if(!r.ok)throw new Error('R2 audio request failed '+r.status);
    return r;
  }
  async function signedPreviewUrl(path,storage='supabase') {
    if (!path || !client()) throw new Error('音声の保存先が見つかりません');
    if(storage==='r2')return '/api/audio?op=preview&path='+encodeURIComponent(path);
    const {data,error}=await client().storage.from(BUCKET).createSignedUrl(path,180);
    if(error || !data?.signedUrl) throw error || new Error('試聴のアクセス許可を取得できません');
    return data.signedUrl;
  }
  const mapRow = row => ({
    id:row.id, ownerId:row.owner_id, cloud:true, audio:!!row.preview_path,
    reviewStatus:row.review_status, isPublished:row.is_published,
    previewPath:row.preview_path, previewStorage:row.preview_storage||'supabase', title:row.title, seller:row.seller_name,
    cat:row.category, type:row.listing_type, price:row.price_yen,
    tag:row.voice_tag, duration:row.duration_label,
    license:row.usage_license, text:row.sample_text || '',
    emoji:'♫', bg:'#ebe5ff', createdAt:Date.parse(row.created_at || '') || 0
  });
  async function refresh() {
    const sb=client();
    if(!sb || !api())return;
    const seq=++generation;
    const fields='id,owner_id,seller_name,title,category,listing_type,price_yen,voice_tag,duration_label,usage_license,sample_text,preview_path,preview_storage,created_at,review_status,is_published';
    try {
      const {data,error}=await sb.from('voice_listings').select(fields)
        .eq('is_published',true).eq('review_status','approved')
        .order('created_at',{ascending:false}).limit(100);
      if(error)throw error;
      if(seq===generation)api().setCloudListings((data||[]).map(mapRow));
    }catch(e){
      console.warn('KOESELL approved listing refresh failed',e);
      if(seq===generation)api().toast('公開中の出品を取得できませんでした');
    }
    if(seq!==generation)return;
    const who=user();
    if(!who){api().setMyListings([]);await loadFavorites();return;}
    try{
      const {data,error}=await sb.from('voice_listings').select(fields)
        .eq('owner_id',who.id).order('created_at',{ascending:false}).limit(100);
      if(error)throw error;
      if(seq===generation)api().setMyListings((data||[]).map(mapRow));
    }catch(e){
      console.warn('KOESELL my submissions refresh failed',e);
      if(seq===generation)api().toast('自分の申請一覧を取得できませんでした');
    }
    if(seq===generation)await loadFavorites();
  }


  async function loadFavorites() {
    const sb=client(),who=user(),seq=++favoriteGeneration;
    if(!sb || !who){api()?.setCloudFavoriteIds([]);return;}
    try{
      const {data,error}=await sb.from('voice_favorites').select('listing_id')
        .eq('user_id',who.id).limit(1000);
      if(error)throw error;
      if(seq===favoriteGeneration && user()?.id===who.id)
        api()?.setCloudFavoriteIds((data||[]).map(x=>x.listing_id));
    }catch(e){
      console.warn('KOESELL favorite load failed',e);
      api()?.toast('お気に入りを同期できませんでした');
    }
  }
  async function toggleFavorite(id,add) {
    const sb=client(),who=user();
    if(!who || !sb){api()?.toast('お気に入りの同期にはログインが必要です');auth()?.open?.();return;}
    try{
      let result;
      if(add) result=await sb.from('voice_favorites')
        .upsert({user_id:who.id,listing_id:id},{onConflict:'user_id,listing_id',ignoreDuplicates:true});
      else result=await sb.from('voice_favorites')
        .delete().eq('user_id',who.id).eq('listing_id',id);
      if(result.error)throw result.error;
      await loadFavorites();
      api()?.toast(add?'お気に入りに追加しました':'お気に入りを解除しました');
    }catch(e){
      console.warn('KOESELL favorite update failed',e);
      api()?.toast('お気に入りを更新できませんでした');
    }
  }

  // In-browser audio recording works around iOS file-picker MIME filtering.
  function setupRecording(form) {
    const recordState = {file:null,recorder:null};
    const startBtn=form.querySelector('#koeniRecordStart');
    const stopBtn=form.querySelector('#koeniRecordStop');
    const status=form.querySelector('#koeniRecordStatus');
    const preview=form.querySelector('#koeniRecordPreview');
    const filePicker=form.querySelector('#cloudAudio');
    const visual=window.KOESELL_RECORDER_UI?.mount(form.querySelector('#koeniRecordVisual'),{
      maxSeconds:60,contextLabel:'試聴用音声'
    });
    let liveStream=null, objectUrl=null, autoStop=null, chunks=[];
    const statusText = text => {if(form.isConnected) status.textContent=text;};
    function releaseStream() {
      if(autoStop){clearTimeout(autoStop);autoStop=null;}
      visual?.stop();
      if(liveStream){liveStream.getTracks().forEach(t=>t.stop());liveStream=null;}
    }
    function discardPreview() {
      if(objectUrl){URL.revokeObjectURL(objectUrl);objectUrl=null;}
      preview.removeAttribute('src');preview.hidden=true;
    }
    function stop() {
      if(recordState.recorder?.state==='recording') recordState.recorder.stop();
      else releaseStream();
    }
    startBtn.addEventListener('click',async()=>{
      if(recordState.recorder?.state==='recording')return;
      if(!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
        statusText('このブラウザでは録音できません。SafariでKOESELLを直接開いてください。');
        return;
      }
      startBtn.disabled=true;statusText('マイクの使用許可を確認しています…');visual?.arm();
      try {
        liveStream=await navigator.mediaDevices.getUserMedia({audio:true});
        if(!form.isConnected){releaseStream();return;}
        const preferred=['audio/mp4','audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus'];
        const mime=preferred.find(type=>MediaRecorder.isTypeSupported?.(type));
        const rec=new MediaRecorder(liveStream,mime?{mimeType:mime}:undefined);
        recordState.recorder=rec;
        recordState.file=null;
        filePicker.value='';
        chunks=[];
        discardPreview();
        rec.ondataavailable=ev=>{if(ev.data?.size)chunks.push(ev.data);};
        rec.onerror=()=>{releaseStream();visual?.fail('もう一度録音するか、ファイルを選んでください');startBtn.disabled=false;stopBtn.disabled=true;statusText('録音に失敗しました。Safariでお試しください。');};
        rec.onstop=()=>{
          releaseStream();startBtn.disabled=false;stopBtn.disabled=true;
          if(!form.isConnected)return;
          const type=rec.mimeType||chunks[0]?.type||'audio/mp4';
          const ext=type.includes('webm')?'webm':type.includes('ogg')?'ogg':type.includes('wav')?'wav':'m4a';
          const blob=new Blob(chunks,{type:acceptable[ext]});
          if(!blob.size){visual?.fail('音声が空でした。もう一度録音してください');statusText('録音データが空です。もう一度お試しください。');return;}
          recordState.file=new File([blob],'koeni-voice-'+Date.now()+'.'+ext,{type:acceptable[ext]});
          objectUrl=URL.createObjectURL(blob);
          preview.src=objectUrl;preview.hidden=false;
          visual?.complete();
          statusText('録音が完了しました。再生して確認し、そのまま公開できます。');
        };
        rec.start();
        visual?.start(liveStream);
        stopBtn.disabled=false;
        statusText('録音中 ● 話し終えたら「録音停止」を押してください（最大60秒）');
        autoStop=setTimeout(()=>{if(rec.state==='recording')rec.stop();},60000);
      }catch(err){
        console.warn('KOENI mic access failed',err);
        releaseStream();startBtn.disabled=false;stopBtn.disabled=true;
        visual?.fail(err?.name==='NotAllowedError'?'マイクの許可が必要です':'マイクを利用できません');
        statusText(err?.name==='NotAllowedError'
          ?'マイクへのアクセスが許可されていません。Safariでマイクを許可してください。'
          :'録音を開始できませんでした。SafariでKOESELLを直接開いてみてください。');
      }
    });
    stopBtn.addEventListener('click',stop);
    filePicker.addEventListener('change',()=>{
      if(filePicker.files?.length){
        recordState.file=null;discardPreview();
        visual?.selected(filePicker.files[0].name);
        statusText('選択ファイル：'+filePicker.files[0].name);
      }
    });
    const observer=new MutationObserver(()=>{
      if(!form.isConnected){
        stop();releaseStream();discardPreview();visual?.destroy();observer.disconnect();
      }
    });
    const root=document.getElementById('modalRoot');
    if(root)observer.observe(root,{childList:true});
    return recordState;
  }

  async function openSell() {
    if (!client() || !user()) {
      api()?.toast('公開出品にはログインが必要です');
      auth()?.open?.();
      return;
    }
    if(window.KOESELL_MESSAGES && !await window.KOESELL_MESSAGES.active())return;
    const who = user();
    const name = String(who.user_metadata?.display_name || 'KOESELLユーザー').slice(0,30);
    const options = ['ショート動画','ナレーション','セリフ・演技','ホラー・怪談','朗読','ASMR・癒し','ゲーム・TRPG','広告・企業']
      .map(x=>'<option>'+esc(x)+'</option>').join('');
    api().openModal('声を出品する（v0.5）', '<div class="hintbox"><b>出品すると即時公開されます。</b> 声を第三者に保存・AI複製される危険を完全には防げません。本人以外の声や個人情報、販売用の本編は投稿しないでください。なりすまし・詐欺・無断AI複製は利用停止の対象です。売買・決済・納品はまだテスト段階です。</div>'+
      '<form id="cloudSellForm">'+
      '<div class="form-grid"><div class="field"><label>出品者名*</label><input name="seller" maxlength="30" minlength="2" required value="'+esc(name)+'"></div>'+
      '<div class="field"><label>カテゴリー*</label><select name="category" required>'+options+'</select></div></div>'+
      '<div class="field"><label>タイトル*</label><input name="title" minlength="2" maxlength="75" required placeholder="例：低い声で怪談を読みます"></div>'+
      '<div class="form-grid"><div class="field"><label>出品形式*</label><select name="listingType"><option value="stock">既製音声</option><option value="custom">オーダー受付（試作）</option></select></div>'+
      '<div class="field"><label>参考価格（円）*</label><input name="price" type="number" min="100" max="100000" step="100" value="500" required></div></div>'+
      '<div class="field"><label>声の特徴*</label><input name="tag" minlength="1" maxlength="35" required placeholder="例：落ち着いた低音"></div>'+
      '<div class="field"><label>長さ・収録条件</label><input name="duration" maxlength="30" placeholder="例：20秒 / 100字まで"></div>'+
      '<div class="field"><label>利用許諾（正式な販売契約ではありません）*</label><select name="license"><option>個人利用のみ</option><option>商用利用可（SNS動画）</option><option>商用利用可（広告・企業利用含む）</option><option>用途によって要相談</option></select></div>'+
      '<div class="field"><label>① この場で試聴音声を録音</label><div id="koeniRecordVisual" class="ksr-slot"></div><div class="ksr-actions"><button id="koeniRecordStart" type="button" class="btn light sm">● 録音開始</button><button id="koeniRecordStop" type="button" class="btn light sm" disabled>■ 録音停止</button></div><p class="help" id="koeniRecordStatus" role="status">最大60秒。録音停止後に試聴できます。</p><audio id="koeniRecordPreview" controls playsinline preload="metadata" hidden style="width:100%;margin:8px 0"></audio></div>'+
      '<div class="field"><label>② または音声ファイルを選ぶ（最大10MB）</label><input name="preview" id="cloudAudio" type="file" accept=".m4a,.mp3,.wav,.ogg,.webm,.aac,.flac,.3gp,.3g2"><div class="help">iPhoneボイスメモのM4Aにも対応。①と②のどちらか一方でOK。登録後は誰でも試聴できます。第三者による音声の複製を完全には防げません。</div></div>'+
      '<div class="field"><label>説明・試聴用文章（任意）</label><textarea name="sampleText" maxlength="350" placeholder="声の雰囲気や読み上げる文章など"></textarea></div>'+
      '<label class="check"><input type="checkbox" name="rights" required><span>自分が権利を保有する声と台本だけを出品し、他人へのなりすまし・詐欺・無断AI複製に利用しません。出品と同時に試聴用音声が一般公開されることを理解しました。</span></label>'+
      '<button type="submit" class="btn primary" style="width:100%">音声サンプルを公開する</button></form>',true);
    const form = document.getElementById('cloudSellForm');
    if(form){const recordState=setupRecording(form);form.addEventListener('submit',e=>saveNew(e,recordState));}
  }
  async function saveNew(e,recordState) {
    e.preventDefault();
    const form=e.currentTarget;
    if (!form.reportValidity()) return;
    const sb=client(), who=user();
    if (!sb || !who) {api().toast('ログインし直してください');return;}
    const fd=new FormData(form);
    if(recordState?.recorder?.state==='recording'){api().toast('録音停止を押してから公開してください');return;}
    const file=form.querySelector('[name="preview"]')?.files?.[0] || recordState?.file;
    const ext=(file?.name?.split('.').pop() || '').toLowerCase();
    const mime=acceptable[ext];
    if (!file || !mime || file.size>MB || file.size===0) {
      api().toast('対応形式（M4A・MP3・WAVなど）とファイル容量10MB以内を確認してください');
      return;
    }
    const title=String(fd.get('title')||'').trim();
    const seller=String(fd.get('seller')||'').trim();
    const tag=String(fd.get('tag')||'').trim();
    const price=Number(fd.get('price'));
    if (title.length<2 || title.length>75 || seller.length<2 || seller.length>30 ||
        !tag || tag.length>35 || !Number.isInteger(price) || price<100 || price>100000 ||
        fd.get('rights')!=='on') {
      api().toast('必須項目を確認してください');return;
    }
    const button=form.querySelector('[type="submit"]');
    button.disabled=true;button.textContent='公開しています…';
    const path=who.id+'/'+crypto.randomUUID()+'.'+ext;
    let uploaded=false,storage='supabase',filePath=path;
    try {
      if(r2Exts.has(ext) && await r2Ready()){
        const {data:session}=await sb.auth.getSession();
        if(!session.session?.access_token)throw new Error('Session expired');
        const response=await fetch('/api/audio?op=upload-preview',{
          method:'POST',headers:{
            Authorization:'Bearer '+session.session.access_token,
            'Content-Type':mime,'x-file-extension':ext
          },body:file
        });
        const payload=await response.json().catch(()=>({error:'invalid_response'}));
        if(!response.ok){
          const code=String(payload?.error||'request_failed').replace(/[^a-z0-9_]/gi,'').slice(0,35);
          throw new Error('R2_UPLOADING_'+response.status+'_'+code);
        }
        if(payload.storage!=='r2'||!payload.path)throw new Error('Invalid R2 response');
        filePath=payload.path;storage='r2';
      }else{
        const upload=await sb.storage.from(BUCKET).upload(path,file,{contentType:mime,upsert:false,cacheControl:'3600'});
        if(upload.error)throw upload.error;
      }
      uploaded=true;
      const listing={
        owner_id:who.id, seller_name:seller, title, category:String(fd.get('category')||''),
        listing_type:String(fd.get('listingType')||''), price_yen:price,
        voice_tag:tag, duration_label:String(fd.get('duration')||'').trim()||'要相談',
        usage_license:String(fd.get('license')||''), sample_text:String(fd.get('sampleText')||'').trim(),
        preview_path:filePath,preview_storage:storage,review_status:'approved',is_published:true
      };
      const {error}=await sb.from('voice_listings').insert(listing);
      if (error) throw error;
      api().closeModal();
      await refresh();
      api().showMyListings();
      api().toast('音声を公開しました。売買・決済はまだデモです');
    } catch(err) {
      console.error('KOENI cloud listing failed',err);
      if(uploaded){
        try{
          if(storage==='r2')await r2Request('preview',filePath);
          else await sb.storage.from(BUCKET).remove([path]);
        }catch(cleanupError){console.warn('Preview cleanup',cleanupError)}
      }
      const reason=String(err?.message||'');
      api().toast(reason.startsWith('R2_UPLOADING_')
        ? '音声保存エラー：'+reason.replace('R2_UPLOADING_','')
        : '出品できませんでした。通信状況・ファイル形式を確認してください');
      button.disabled=false;button.textContent='音声サンプルを公開する';
    }
  }
  async function deleteVoice(id) {
    const sb=client(),who=user();
    if (!sb || !who) {auth()?.open?.();return;}
    if (!confirm('この出品を削除しますか？ 音声ファイルも削除されます。')) return;
    const {data,error:fetchError}=await sb.from('voice_listings')
      .select('preview_path,preview_storage').eq('id',id).eq('owner_id',who.id).maybeSingle();
    if(fetchError || !data){api().toast('出品を確認できませんでした');return;}
    const {data:master,error:masterError}=await sb.from('voice_products').select('master_path,storage_backend').eq('listing_id',id).maybeSingle();
    if(masterError){api().toast('販売本編を確認できませんでした');return;}
    const {error}=await sb.from('voice_listings').delete().eq('id',id).eq('owner_id',who.id);
    if(error){api().toast('購入履歴に関連する出品は削除できません。運営に連絡してください');return;}
    if(master?.master_path){
      try{
        if(master.storage_backend==='r2')await r2Request('master',master.master_path);
        else {
          const removed=await sb.storage.from('koesell-masters').remove([master.master_path]);
          if(removed.error)console.warn('Master cleanup failed',removed.error);
        }
      }catch(cleanupError){console.warn('KOESELL master cleanup failed',cleanupError)}
    }
    if(data.preview_path){
      try{
        if(data.preview_storage==='r2')await r2Request('preview',data.preview_path);
        else {
          const result=await sb.storage.from(BUCKET).remove([data.preview_path]);
          if(result.error)console.warn('Preview cleanup failed',result.error);
        }
      }catch(cleanupError){console.warn('KOESELL preview cleanup failed',cleanupError)}
    }
    await refresh();
    api().showMyListings();
    api().toast('公開出品を削除しました');
  }

  function reportVoice(id) {
    if(!client() || !user()){api().toast('通報するにはログインしてください');auth()?.open?.();return;}
    api().openModal('出品を通報する',
      '<div class="hintbox">なりすまし、AI複製、権利侵害などの疑いを運営に報告します。緊急の危険がある場合は警察等にも連絡してください。通報だけでは自動的に公開停止されません。</div>'+
      '<form id="voiceReportForm"><div class="field"><label>理由*</label><select name="reason" required>'+
      '<option value="impersonation">他人へのなりすまし</option>'+
      '<option value="voice_cloning">無断のAI音声複製</option>'+
      '<option value="rights">著作権・音声の権利侵害</option>'+
      '<option value="fraud">詐欺などへの悪用</option>'+
      '<option value="other">その他</option></select></div>'+
      '<div class="field"><label>状況（任意・500文字まで）</label>'+
      '<textarea name="details" maxlength="500" placeholder="確認した内容を簡潔に記入してください"></textarea></div>'+
      '<button class="btn primary" type="submit">運営へ通報する</button></form>',true);
    document.getElementById('voiceReportForm')?.addEventListener('submit',async e=>{
      e.preventDefault();
      const form=e.currentTarget, submit=form.querySelector('[type=submit]');
      const who=user();
      if(!who){api().toast('ログインし直してください');return;}
      submit.disabled=true;
      const data=new FormData(form);
      const {error}=await client().from('voice_reports').insert({
        listing_id:id,reporter_id:who.id,
        reason:String(data.get('reason')||'other'),
        details:String(data.get('details')||'').trim()
      });
      if(error){
        submit.disabled=false;
        api().toast(error.code==='23505'?'この出品はすでに通報済みです':'通報できませんでした。後で再試行してください');
        return;
      }
      api().closeModal();
      api().toast('通報を受け付けました');
    });
  }
  window.KOENI_CLOUD = {openSell,deleteVoice,signedPreviewUrl,refresh,reportVoice,toggleFavorite};
  window.addEventListener('koeni:auth-ready',refresh);
  window.addEventListener('koeni:auth-state',refresh);
  if(client()) refresh();
})();
