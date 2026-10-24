/* KOESELL recording monitor v1.0
 * Visualizes microphone input locally through the Web Audio API.
 * The analyser is never connected to audio output or any network.
 */
(() => {
  'use strict';
  const esc = value => String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const clock = seconds => {
    const s=Math.max(0,Math.floor(seconds));
    return String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0');
  };
  function mount(element,{maxSeconds=60,contextLabel='試聴用サンプル'}={}){
    if(!element)return null;
    let raf=0,context=null,analyser=null,source=null,data=null,startedAt=0,elapsedMs=0,phase='idle',gone=false;
    const count=46,levels=new Float32Array(count),maxMs=Math.max(1,maxSeconds)*1000;
    element.innerHTML=
      '<section class="ksr" data-ksr-phase="idle" aria-label="'+esc(contextLabel)+'の録音画面">'+
      '<div class="ksr-heading">'+
      '<div class="ksr-indicator"><span class="ksr-dot"></span><span class="ksr-stage" aria-live="polite">録音待機中</span></div>'+
      '<span class="ksr-clock"><strong class="ksr-elapsed">00:00</strong><span class="ksr-max"> / '+clock(maxSeconds)+'</span></span></div>'+
      '<div class="ksr-visual"><canvas class="ksr-canvas" height="104" aria-label="声の大きさに連動するリアルタイム波形" role="img"></canvas>'+
      '<div class="ksr-centerline"></div></div>'+
      '<div class="ksr-footer"><span class="ksr-helper">マイクを許可して録音を開始</span>'+
      '<span class="ksr-signal"><span class="ksr-signal-dot"></span><span class="ksr-meter-text">MIC READY</span></span></div>'+
      '</section>';
    const root=element.querySelector('.ksr'),canvas=element.querySelector('canvas');
    const elapsedNode=element.querySelector('.ksr-elapsed'),stageNode=element.querySelector('.ksr-stage');
    const helpNode=element.querySelector('.ksr-helper'),meterNode=element.querySelector('.ksr-meter-text');
    const ctx=canvas?.getContext?.('2d');
    let cachedWidth=0,cachedHeight=0;
    function prepare(){
      if(!ctx||!canvas)return null;
      const rect=canvas.getBoundingClientRect();
      const width=Math.max(1,rect.width||280),height=104;
      const dpr=Math.min(2,window.devicePixelRatio||1);
      const pw=Math.round(width*dpr),ph=Math.round(height*dpr);
      if(canvas.width!==pw||canvas.height!==ph){
        canvas.width=pw;canvas.height=ph;
        cachedWidth=width;cachedHeight=height;
        ctx.setTransform(dpr,0,0,dpr,0,0);
      }else if(!cachedWidth||!cachedHeight){
        cachedWidth=width;cachedHeight=height;
        ctx.setTransform(dpr,0,0,dpr,0,0);
      }
      return {width:cachedWidth,height:cachedHeight};
    }
    function render(){
      if(gone)return;
      const dims=prepare();
      if(!dims)return;
      const {width,height}=dims;
      ctx.clearRect(0,0,width,height);
      const barSpace=width/count,mid=height/2;
      const live=phase==='recording'&&analyser&&data;
      if(live){
        analyser.getByteTimeDomainData(data);
        const sampleCount=data.length;
        for(let i=0;i<count;i++){
          const begin=Math.floor(i*sampleCount/count),end=Math.max(begin+1,Math.floor((i+1)*sampleCount/count));
          let peak=0;
          for(let k=begin;k<end;k++){
            const sample=Math.abs((data[k]-128)/128);
            if(sample>peak)peak=sample;
          }
          const target=Math.min(1,Math.pow(peak,0.68)*1.38);
          levels[i]=Math.max(target,levels[i]*0.76);
        }
      }else{
        for(let i=0;i<count;i++)levels[i]*=phase==='idle'?0.8:0.91;
      }
      for(let i=0;i<count;i++){
        const x=(i+.5)*barSpace;
        const initial=phase==='idle'?1.8+3*Math.pow(Math.sin((i+1)*.34),2):2;
        const h=initial+levels[i]*(height*.40);
        ctx.strokeStyle=phase==='recording'
          ? (i%5===0?'#fff3fe':'#bd9afc')
          : phase==='complete'?'#9ce7d6':'#9686b8';
        ctx.globalAlpha=phase==='recording'?.97:.78;
        ctx.lineWidth=Math.max(2,Math.min(5,barSpace*.53));
        ctx.lineCap='round';
        ctx.beginPath();ctx.moveTo(x,mid-h);ctx.lineTo(x,mid+h);ctx.stroke();
      }
      ctx.globalAlpha=1;
      if(phase==='recording'){
        elapsedMs=Math.min(maxMs,performance.now()-startedAt);
        elapsedNode.textContent=clock(elapsedMs/1000);
      }
    }
    function loop(){
      if(gone)return;
      render();
      if(phase==='recording')raf=requestAnimationFrame(loop);
      else raf=0;
    }
    function paintOnce(){
      if(gone)return;
      if(raf){cancelAnimationFrame(raf);raf=0}
      render();
    }
    function update(next,label,helper,meter){
      if(gone)return;
      phase=next;
      root.dataset.ksrPhase=next;
      stageNode.textContent=label;
      helpNode.textContent=helper;
      meterNode.textContent=meter;
      paintOnce();
    }
    function unplug(){
      if(raf){cancelAnimationFrame(raf);raf=0}
      try{source?.disconnect()}catch{}
      source=null;analyser=null;data=null;
      if(context&&context.state!=='closed'){void context.close().catch(()=>{})}
      context=null;
    }
    // Called synchronously from the tap handler, before the asynchronous
    // microphone permission prompt. This is necessary on some iOS browsers
    // where Web Audio cannot start outside a user activation gesture.
    function arm(){
      if(gone)return;
      if(!context){
        try{
          const AC=window.AudioContext||window.webkitAudioContext;
          if(AC)context=new AC();
        }catch(e){console.warn('Recording audio monitor unavailable',e?.name||'unknown')}
      }
      if(context?.state==='suspended')void context.resume().catch(()=>{});
      elapsedNode.textContent='00:00';levels.fill(0);
      update('waiting','マイクを準備中','端末のマイク使用を許可してください','MIC SETUP');
    }
    function start(stream){
      if(gone)return;
      if(source){try{source.disconnect()}catch{}}
      source=null;analyser=null;data=null;
      elapsedMs=0;startedAt=performance.now();
      elapsedNode.textContent='00:00';levels.fill(0);
      try{
        if(!context){
          const AC=window.AudioContext||window.webkitAudioContext;
          if(AC)context=new AC();
        }
        if(context){
          analyser=context.createAnalyser();
          analyser.fftSize=2048;
          analyser.smoothingTimeConstant=.73;
          data=new Uint8Array(analyser.fftSize);
          source=context.createMediaStreamSource(stream);
          source.connect(analyser); // Never connect to speakers.
          if(context.state==='suspended')void context.resume().catch(()=>{});
        }
      }catch(e){
        console.warn('Recording waveform unavailable',e?.name||'unknown');
        unplug(); // Recording still works even without Web Audio support.
      }
      update('recording','録音中','声に合わせて波形が動きます','LIVE INPUT');
      if(!raf)raf=requestAnimationFrame(loop);
    }
    function stop(){
      if(phase!=='recording')return;
      elapsedMs=Math.min(maxMs,performance.now()-startedAt);
      unplug();
      elapsedNode.textContent=clock(elapsedMs/1000);
      update('processing','録音を処理中','音声を準備しています…','PROCESSING');
    }
    function complete(){
      unplug();
      update('complete','録音完了','下のプレーヤーで確認できます','TAKE SAVED');
    }
    function reset(){
      unplug();elapsedMs=0;elapsedNode.textContent='00:00';levels.fill(0);
      update('idle','録音待機中','マイクを許可して録音を開始','MIC READY');
    }
    function selected(name){
      unplug();
      update('complete','ファイル選択済み',name?'選択：'+name:'ファイルを選択しました','FILE READY');
    }
    function fail(message){
      unplug();update('error','録音できませんでした',message||'マイクの許可を確認してください','MIC ERROR');
    }
    function destroy(){
      unplug();gone=true;levels.fill(0);
      if(element.isConnected)element.replaceChildren();
    }
    paintOnce();
    return {arm,start,stop,complete,reset,selected,fail,destroy};
  }
  window.KOESELL_RECORDER_UI={mount};
})();
