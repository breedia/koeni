/* KOESELL v1.0 — Stripe Connect onboarding UI. No bank/KYC information enters this site. */
(() => {
  'use strict';
  const api=()=>window.KOENI_DEMO_API;
  const auth=()=>window.KOENI_AUTH;
  const db=()=>auth()?.getClient?.();
  const me=()=>auth()?.getUser?.();
  let busy=false;
  const notice=message=>api()?.toast?.(message);
  async function invoke(action){
    const client=db();
    if(!client||!me())throw Error('login_required');
    const {data,error}=await client.functions.invoke('koesell-connect',{body:{action}});
    if(error)throw error;
    if(data?.error)throw Error(data.error);
    return data||{};
  }
  async function open(){
    if(!db()||!me()){
      notice('売上受取の設定にはログインが必要です');
      auth()?.open?.();
      return;
    }
    api().openModal('売上受取の設定',
      '<p class="muted" id="connectLoading" aria-live="polite">Stripeの登録状況を確認しています…</p>',true);
    try{
      const info=await invoke('status');
      const pending=document.getElementById('connectLoading');
      if(!pending)return;
      const test=info.mode==='test';
      let html='<div class="hintbox"><b>Stripe Connect（売上受取）</b><p style="margin:7px 0 0">振込先口座や本人確認情報はStripeで直接登録します。KOESELLには保存しません。</p></div>';
      if(!info.configured){
        html+='<p>運営側のStripe接続設定を準備しています。まだ登録は開始できません。</p>';
      }else if(!info.connected){
        html+='<p>売上を受け取るには、Stripeで出品者登録が必要です。</p>';
      }else if(info.ready){
        html+='<p><b>受取先の登録が確認できました。</b></p>';
      }else{
        html+='<p><b>登録途中です。</b> Stripeで必要な情報を確認し、入力を続けてください。</p>';
      }
      if(info.configured){
        html+=test
          ?'<p class="muted">現在はテスト環境です。ここでの登録や取引では実際の振込は発生しません。本番用の登録は別途必要です。</p>'
          :'<p class="muted">実際の売上受取は、サービスの決済開始後に利用可能です。</p>';
        html+='<div class="ksr-actions" style="margin:14px 0">'+
          (info.connected&&info.ready?'':'<button type="button" class="btn primary" id="connectStart">Stripeで登録を'+(info.connected?'続ける':'始める')+' →</button>')+
          '<button type="button" class="btn light" id="connectRefresh">状態を更新</button></div>';
      }
      pending.outerHTML=html;
      document.getElementById('connectStart')?.addEventListener('click',()=>onboard());
      document.getElementById('connectRefresh')?.addEventListener('click',()=>open());
    }catch(err){
      console.warn('KOESELL connect status',err);
      const p=document.getElementById('connectLoading');
      if(p)p.textContent='Stripeの登録状況を確認できませんでした。時間をおいて再度お試しください。';
    }
  }
  async function onboard(){
    if(busy)return;
    if(!db()||!me()){auth()?.open?.();return}
    busy=true;
    const button=document.getElementById('connectStart');
    if(button){button.disabled=true;button.textContent='Stripeに接続しています…'}
    try{
      const info=await invoke('onboard');
      const url=new URL(info.url);
      if(url.protocol!=='https:'||url.hostname!=='connect.stripe.com')
        throw Error('invalid_connect_url');
      window.location.assign(info.url);
    }catch(err){
      console.warn('KOESELL connect onboarding',err);
      notice('Stripeの登録を開始できません。運営側の接続設定が完了してからお試しください。');
      if(button?.isConnected){button.disabled=false;button.textContent='Stripeで登録を再開する →'}
    }finally{busy=false}
  }
  let restoring=false;
  async function onReturn(){
    if(restoring)return;
    const url=new URL(window.location.href);
    const action=url.searchParams.get('stripe_connect');
    if(action!=='return'&&action!=='refresh')return;
    if(!db()||!me())return;
    restoring=true;
    url.searchParams.delete('stripe_connect');
    history.replaceState(history.state,'',url.pathname+url.search+url.hash);
    if(action==='refresh')await onboard();
    else await open(); // Return from Stripe does not itself prove KYC was completed.
  }
  window.KOESELL_CONNECT={open};
  window.addEventListener('koeni:auth-ready',onReturn);
  window.addEventListener('koeni:auth-state',onReturn);
  onReturn();
})();
