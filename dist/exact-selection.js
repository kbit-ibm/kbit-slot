(function(root){
  'use strict';
  const SCOPE='milp-destinos-seleccionados';
  function candidates(engine,rules){const pinned=new Set(rules.pinned||[]);return engine.products.filter(p=>!pinned.has(p.id)).map(p=>p.id);}
  function prepare(engine,assignment,rules,selected,local=true,limit=14){
    const ids=[...new Set(selected)];
    if(!ids.length||ids.length>limit||ids.some(id=>!Number.isInteger(id)||id<0||id>=engine.products.length))throw new Error('Selecciona entre 1 y '+limit+' productos para MILP.');
    const chosen=new Set(ids),pinned=engine.products.filter(p=>!chosen.has(p.id)).map(p=>p.id);
    const zones=engine.zones(rules).filter(z=>z.id!==SCOPE);
    if(local){
      const occupied=new Set(assignment),free=engine.layout.assignable.filter(s=>!occupied.has(s));
      const slots=new Set(ids.map(id=>assignment[id]));
      function allowed(id,slot){
        const p=engine.products[id],s=engine.layout.slots[slot],aisle=engine.layout.spec.aisles?.[s.aisle]||s.aisleName;
        return zones.filter(z=>z.products?.includes(id)||z.families?.includes(p.family)).every(z=>(!z.aisles||z.aisles.includes(aisle))&&(!z.levels||z.levels.includes(s.level+1))&&(!z.slots||z.slots.includes(s.name)));
      }
      for(const id of ids){
        let best=-1,cost=Infinity;
        for(const slot of free)if(allowed(id,slot)){const d=engine.distance(assignment[id],slot);if(d<cost){best=slot;cost=d;}}
        if(best>=0)slots.add(best);
      }
      // Reservations remain available for temporary steps but never as final destinations.
      engine.layout.reserved.forEach(s=>slots.add(s));
      zones.push({id:SCOPE,label:'Destinos acotados para MILP',products:ids,slots:[...slots].map(s=>engine.slotName(s))});
    }
    return {...rules,pinned,zones};
  }
  const api={candidates,prepare,SCOPE};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.KbitExactSelection=api;
})(typeof window!=='undefined'?window:globalThis);
