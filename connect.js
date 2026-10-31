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
    if(error){
      // Supabase returns HTTP >=400 as FunctionsHttpError. Extract our safe
      // diagnostic code from the JSON response without exposing Stripe secrets.
      let response=null;
      try{response=await error.context?.json?.()}catch(_){}
      const e=new Error(response?.error||error.message||'connect_request_failed');
      e.reason=typeof response?.reason==='string'?response.reason:
        typeof response?.stripeCode==='string'?response.stripeCode:'';
      e.stage=typeof response?.stage==='string'?response.stage:'';
      throw e;
    }
    if(data?.error){
      const e=new Error(data.error);
      e.reason=typeof data.reason==='string'?data.reason:
        typeof data.stripeCode==='string'?data.stripeCode:'';
      e.stage=typeof data.stage==='string'?data.stage:'';
      throw e;
    }
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
      document.getElementById('connectStart')?.addEventListener('click',()=>embedded());
      document.getElementById('connectRefresh')?.addEventListener('click',()=>open());
    }catch(err){
      console.warn('KOESELL connect status',err);
      const p=document.getElementById('connectLoading');
      if(p)p.textContent='Stripeの登録状況を確認できませんでした。時間をおいて再度お試しください。';
    }
  }
  let sdkLoading=null;
  function loadSdk(){
    if(window.StripeConnect)return Promise.resolve();
    if(sdkLoading)return sdkLoading;
    sdkLoading=new Promise((resolve,reject)=>{
      const script=document.createElement('script');
      script.src='https://connect-js.stripe.com/v1.0/connect.js';
      script.onload=()=>window.StripeConnect?resolve():reject(Error('sdk_unavailable'));
      script.onerror=()=>reject(Error('sdk_unavailable'));
      document.head.appendChild(script);
    });
    return sdkLoading;
  }
  async function embedded(){
    if(busy)return;
    busy=true;
    const button=document.getElementById('connectStart');
    if(button){button.disabled=true;button.textContent='登録画面を準備中…'}
    try{
      const session=await invoke('embedded');
      await loadSdk();
      let first=session.clientSecret;
      const instance=window.StripeConnect.init({
        publishableKey:session.publishableKey,
        fetchClientSecret:async()=>{
          if(first){const value=first;first=null;return value}
          return (await invoke('embedded')).clientSecret;
        },
        appearance:{variables:{colorPrimary:'#6246b5'}}
      });
      const root=document.getElementById('connectStart')?.parentElement;
      if(!root)throw Error('modal_closed');
      root.outerHTML='<div id="connectEmbedHost" style="min-height:350px;margin:12px 0"></div><button type="button" class="btn light" id="connectEmbedRefresh">登録状況を確認</button>';
      const component=instance.create('account-onboarding');
      component.setOnExit(()=>open());
      document.getElementById('connectEmbedHost').appendChild(component);
      document.getElementById('connectEmbedRefresh')?.addEventListener('click',open);
    }catch(err){
      console.warn('KOESELL embedded onboarding',err);
      notice('サイト内登録を利用できないため、Stripeの登録画面に切り替えます');
      busy=false;
      await onboard();
    }finally{busy=false}
  }
  async function onboard(){
    if(busy)return;
    if(!db()||!me()){auth()?.open?.();return}
    busy=true;
    const button=document.getElementById('connectStart');
    const originalLabel=button?.textContent||'Stripeで登録を始める →';
    if(button){button.disabled=true;button.textContent='Stripeに接続しています…'}
    try{
      const info=await invoke('onboard');
      const url=new URL(info.url);
      if(url.protocol!=='https:'||url.hostname!=='connect.stripe.com')
        throw Error('invalid_connect_url');
      window.location.assign(info.url);
    }catch(err){
      console.warn('KOESELL connect onboarding',err);
      const messages={
        accounts_v1_requires_opt_in:'StripeのAccounts v1互換設定が必要です。運営側で対応します。',
        transfers_requires_approval:'Stripeで送金機能の承認が必要です。運営側で対応します。',
        platform_profile_required:'Stripe Connectのプラットフォーム情報が未設定です。',
        platform_activation_required:'Stripe側の事業者登録が未完了です。',
        api_creation_restricted:'StripeがAPIからの出品者作成を制限しています。',
        connect_platform_required:'Stripe Connectの利用設定が必要です。',
        account_creation_liability_unacknowledged:'Stripe Connectで損失負担に関する設定が必要です。',
        account_creation_requirement_collection_and_liability_unacknowledged:'Stripe Connectで本人確認と損失負担の確認が必要です。',
        account_creation_requirement_collection_unacknowledged:'Stripe Connectで本人確認の収集設定が必要です。',
        connect_profile_not_submitted:'Stripe Connectのプラットフォーム情報を完了してください。',
        account_create_activation_required:'Stripe Connectの有効化手続きが必要です。',
        connect_identity_not_verified:'Stripeでプラットフォーム本人確認が未完了です。',
        accounts_v2_access_blocked:'StripeでAccounts v2の利用許可が必要です。',
        account_capability_not_supported:'Stripeで送金機能を利用できません。Connect設定を確認してください。',
        cannot_create_connected_account:'Stripeが連結アカウント作成を制限しています。Connect設定を確認してください。'
      };
      const reason=typeof err.reason==='string'&&err.reason?err.reason:'unclassified';
      const message=messages[reason]||'Stripeが出品者登録を拒否しました。運営側で詳細を確認します。';
      notice(message);
      const container=document.getElementById('connectFailure')||document.getElementById('connectStart')?.parentElement;
      if(container){
        const p=document.createElement('p');
        p.id='connectFailure';
        p.className='muted';
        p.style.cssText='color:#aa2929;font-size:.9rem;margin:12px 0;';
        p.textContent=message+'（診断コード: '+reason.slice(0,50)+'）';
        const old=document.getElementById('connectFailure');
        if(old)old.replaceWith(p);
        else container.appendChild(p);
      }
      if(button?.isConnected){button.disabled=false;button.textContent=originalLabel}
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
