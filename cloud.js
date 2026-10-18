/* KOENI v0.3: Public preview-only marketplace listings. No sales or fulfillment. */
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
  const api = () => window.KOENI_DEMO_API;
  const auth = () => window.KOENI_AUTH;
  const client = () => auth()?.getClient?.();
  const user = () => auth()?.getUser?.();
  const esc = s => String(s ?? '').replace(/[&<>"']/g, ch =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const publicUrl = path => {
    if (!path || !client()) return '';
    return client().storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  };
  const mapRow = row => ({
    id:row.id, ownerId:row.owner_id, cloud:true, audio:!!row.preview_path,
    previewPath:row.preview_path, title:row.title, seller:row.seller_name,
    cat:row.category, type:row.listing_type, price:row.price_yen,
    tag:row.voice_tag, duration:row.duration_label,
    license:row.usage_license, text:row.sample_text || '',
    emoji:'♫', bg:'#ebe5ff', createdAt:Date.parse(row.created_at || '') || 0
  });
  async function refresh() {
    const sb = client();
    if (!sb || !api()) return;
    const seq = ++generation;
    try {
      const {data,error} = await sb.from('voice_listings')
        .select('id,owner_id,seller_name,title,category,listing_type,price_yen,voice_tag,duration_label,usage_license,sample_text,preview_path,created_at')
        .eq('is_published',true).order('created_at',{ascending:false}).limit(100);
      if (error) throw error;
      if (seq === generation) api().setCloudListings((data || []).map(mapRow));
    } catch(e) {
      console.warn('KOENI voice listing refresh failed',e);
      if (seq === generation) api().toast('公開中の声を取得できませんでした。後で再読み込みしてください');
    }
  }
  function openSell() {
    if (!client() || !user()) {
      api()?.toast('公開出品にはログインが必要です');
      auth()?.open?.();
      return;
    }
    const who = user();
    const name = String(who.user_metadata?.display_name || 'KOENIユーザー').slice(0,30);
    const options = ['ショート動画','ナレーション','セリフ・演技','ホラー・怪談','朗読','ASMR・癒し','ゲーム・TRPG','広告・企業']
      .map(x=>'<option>'+esc(x)+'</option>').join('');
    api().openModal('音声サンプルを公開出品', '<div class="hintbox"><b>公開テスト機能</b>：商品情報と試聴用音声は、ログインしていない人にも公開されます。販売・決済・受注・本編音声の納品はまだできません。<b>自分が権利を持つサンプルだけ</b>を登録してください。</div>'+
      '<form id="cloudSellForm">'+
      '<div class="form-grid"><div class="field"><label>出品者名*</label><input name="seller" maxlength="30" minlength="2" required value="'+esc(name)+'"></div>'+
      '<div class="field"><label>カテゴリー*</label><select name="category" required>'+options+'</select></div></div>'+
      '<div class="field"><label>タイトル*</label><input name="title" minlength="2" maxlength="75" required placeholder="例：低い声で怪談を読みます"></div>'+
      '<div class="form-grid"><div class="field"><label>出品形式*</label><select name="listingType"><option value="stock">既製音声</option><option value="custom">オーダー受付（試作）</option></select></div>'+
      '<div class="field"><label>参考価格（円）*</label><input name="price" type="number" min="100" max="100000" step="100" value="500" required></div></div>'+
      '<div class="field"><label>声の特徴*</label><input name="tag" minlength="1" maxlength="35" required placeholder="例：落ち着いた低音"></div>'+
      '<div class="field"><label>長さ・収録条件</label><input name="duration" maxlength="30" placeholder="例：20秒 / 100字まで"></div>'+
      '<div class="field"><label>利用許諾（正式な販売契約ではありません）*</label><select name="license"><option>個人利用のみ</option><option>商用利用可（SNS動画）</option><option>商用利用可（広告・企業利用含む）</option><option>用途によって要相談</option></select></div>'+
      '<div class="field"><label>公開する試聴用音声（必須・最大10MB）*</label><input name="preview" id="cloudAudio" type="file" accept=".mp3,.m4a,.wav,.ogg,.webm,.aac,.flac,.3gp,.3g2,audio/*" required><div class="help">スマホで録った短いサンプルを推奨。アップロードしたファイルは一般公開されます。販売する本編を登録しないでください。</div></div>'+
      '<div class="field"><label>説明・試聴用文章（任意）</label><textarea name="sampleText" maxlength="350" placeholder="声の雰囲気や読み上げる文章など"></textarea></div>'+
      '<label class="check"><input type="checkbox" name="rights" required><span>音声と台本の利用権を保有し、他人の声を無断収録・模倣したものや権利侵害する音声ではありません。一般公開されることを理解しました。</span></label>'+
      '<button type="submit" class="btn primary" style="width:100%">試聴用音声を公開する</button></form>',true);
    const form = document.getElementById('cloudSellForm');
    form?.addEventListener('submit',saveNew);
  }
  async function saveNew(e) {
    e.preventDefault();
    const form=e.currentTarget;
    if (!form.reportValidity()) return;
    const sb=client(), who=user();
    if (!sb || !who) {api().toast('ログインし直してください');return;}
    const fd=new FormData(form);
    const file=form.querySelector('[name="preview"]')?.files?.[0];
    const ext=(file?.name?.split('.').pop() || '').toLowerCase();
    const mime=acceptable[ext];
    if (!file || !mime || file.size>MB || file.size===0) {
      api().toast('音声形式（MP3/M4A/WAVなど）・10MB以内で選択してください');
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
    let uploaded=false;
    try {
      const upload=await sb.storage.from(BUCKET).upload(path,file,{contentType:mime,upsert:false,cacheControl:'3600'});
      if (upload.error) throw upload.error;
      uploaded=true;
      const listing={
        owner_id:who.id, seller_name:seller, title, category:String(fd.get('category')||''),
        listing_type:String(fd.get('listingType')||''), price_yen:price,
        voice_tag:tag, duration_label:String(fd.get('duration')||'').trim()||'要相談',
        usage_license:String(fd.get('license')||''), sample_text:String(fd.get('sampleText')||'').trim(),
        preview_path:path, is_published:true
      };
      const {error}=await sb.from('voice_listings').insert(listing);
      if (error) throw error;
      api().closeModal();
      await refresh();
      api().toast('試聴用の声を公開しました。購入機能はまだデモです');
      document.getElementById('voices')?.scrollIntoView({behavior:'smooth'});
    } catch(err) {
      console.error('KOENI cloud listing failed',err);
      if(uploaded) await sb.storage.from(BUCKET).remove([path]);
      api().toast('公開できませんでした。通信状況・ファイル形式を確認してください');
      button.disabled=false;button.textContent='試聴用音声を公開する';
    }
  }
  async function deleteVoice(id) {
    const sb=client(),who=user();
    if (!sb || !who) {auth()?.open?.();return;}
    if (!confirm('この公開出品を削除しますか？ 公開済みサンプル音声も削除されます。')) return;
    const {data,error:fetchError}=await sb.from('voice_listings')
      .select('preview_path').eq('id',id).eq('owner_id',who.id).maybeSingle();
    if(fetchError || !data){api().toast('出品を確認できませんでした');return;}
    const {error}=await sb.from('voice_listings').delete().eq('id',id).eq('owner_id',who.id);
    if(error){api().toast('削除できませんでした');return;}
    if(data.preview_path) {
      const result=await sb.storage.from(BUCKET).remove([data.preview_path]);
      if(result.error) console.warn('KOENI preview cleanup failed',result.error);
    }
    await refresh();
    api().showMyListings();
    api().toast('公開出品を削除しました');
  }
  window.KOENI_CLOUD = {openSell,deleteVoice,publicUrl,refresh};
  window.addEventListener('koeni:auth-ready',refresh);
  window.addEventListener('koeni:auth-state',refresh);
  if(client()) refresh();
})();
