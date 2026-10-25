/* Client for the optional Python calculation service (server/). Without it the page keeps using the browser engine. */
(function () {
  'use strict';
  const LOCAL_SERVICE='http://127.0.0.1:8000';
  let base=null,health=null,checkedAt=0;
  const abortError=()=>Object.assign(new Error('Cálculo cancelado.'),{name:'AbortError'});
  const pause=(ms,signal)=>new Promise((resolve,reject)=>{const timer=setTimeout(resolve,ms);signal?.addEventListener('abort',()=>{clearTimeout(timer);reject(abortError());},{once:true});});
  async function request(url,options={},timeout=8000){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);
    try{const response=await fetch(url,{...options,signal:controller.signal});const data=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(Array.isArray(data.detail)?data.detail.map(item=>item.msg).join(' · '):data.detail||'El servidor respondió '+response.status+'.');return data;}
    finally{clearTimeout(timer);}
  }
  // Same origin when the service serves the page (python -m server); otherwise its default local address.
  async function connect(force=false){
    if(!force&&Date.now()-checkedAt<15000)return health;
    const candidates=location.protocol.startsWith('http')?['',LOCAL_SERVICE]:[LOCAL_SERVICE];
    for(const candidate of candidates){try{const answer=await request(candidate+'/api/health',{},6000);if(answer.status!=='ok'||!Array.isArray(answer.solvers))continue;health=answer;base=candidate;checkedAt=Date.now();return health;}catch{}}
    health=null;base=null;checkedAt=Date.now();return null;
  }
  // Runs a job on the service and turns its target into a plan with the browser engine, which validates it again.
  async function solve(initial,orders,rules,{solver='clasico',options={},key='',onProgress,signal,engine:E=window.KbitEngine}={}){
    if(!await connect())throw new Error('El servidor de cálculo no responde. Inícialo con «python -m server».');
    if(signal?.aborted)throw abortError();
    const job=await request(base+'/api/solve',{method:'POST',headers:{'Content-Type':'application/json',...(key?{'X-Kbit-Key':key}:{})},body:JSON.stringify({spec:E.spec,initial,orders,rules,solver,options})},15000);
    const cancel=()=>fetch(base+'/api/jobs/'+job.id,{method:'DELETE'}).catch(()=>{});
    try{
      for(;;){
        if(signal?.aborted)throw abortError();
        const state=await request(base+'/api/jobs/'+job.id);
        onProgress?.({...state.progress,done:false});
        if(state.status==='done')return E.planFrom(initial,orders,rules,state.result.target,state.result.solver);
        if(state.status==='failed')throw new Error(state.error);
        if(state.status==='cancelled')throw abortError();
        await pause(350,signal);
      }
    }catch(error){if(error.name==='AbortError')cancel();throw error;}
  }
  window.KbitRemote={connect,solve,status:()=>health,checked:()=>checkedAt>0};
})();
