/* KOESELL operator navigation: UI links only; authorization is enforced by Supabase RLS and RPC. */
(() => {
  'use strict';
  let checkNo=0;
  window.KOESELL_OPERATOR_ACCESS=false;
  function setAccess(access) {
    const allowed=access===true;
    if(window.KOESELL_OPERATOR_ACCESS===allowed)return;
    window.KOESELL_OPERATOR_ACCESS=allowed;
    window.KOENI_DEMO_API?.setOperatorAccess?.(allowed);
    window.dispatchEvent(new Event('koesell:operator-changed'));
  }
  function update() {
    const seq=++checkNo;
    const client=window.KOENI_AUTH?.getClient?.();
    const user=window.KOENI_AUTH?.getUser?.();
    setAccess(false);
    if(!client || !user)return;
    // Running async auth queries outside Supabase's synchronous auth event callback
    // prevents reentrancy when login state changes.
    window.setTimeout(async()=>{
      try{
        const {data,error}=await client.rpc('koesell_admin_access');
        if(error)throw error;
        if(seq!==checkNo || window.KOENI_AUTH?.getUser?.()?.id!==user.id)return;
        setAccess(data===true);
      }catch(error) {
        if(seq===checkNo) {
          setAccess(false);
          console.warn('KOESELL admin access check failed',error);
        }
      }
    },0);
  }
  window.addEventListener('koeni:auth-ready',update);
  window.addEventListener('koeni:auth-state',update);
  update();
})();