(function(root) {
  'use strict';
  function validate(data, Base) {
    const fail = message => { throw new Error(message); };
    if (!data || !data.spec || !Array.isArray(data.spec.products) || !Array.isArray(data.spec.groups)) fail('Incluye spec.products y spec.groups.');
    const products = data.spec.products;
    if (!products.length || products.length > 2000) fail('Se admiten entre 1 y 2.000 productos.');
    if (!data.spec.layout || data.spec.layout.kind || data.spec.layout.levels !== 1) fail('Importa un plano rectangular de un nivel.');
    const l = data.spec.layout;
    if (!Array.isArray(l.aisles) || !l.aisles.every(a => typeof a === 'string' && /^[A-Za-z0-9_-]{1,20}$/.test(a))) fail('Usa nombres de pasillo de hasta 20 letras, números, guiones o guiones bajos.');
    if (!Array.isArray(l.aisles) || !Number.isInteger(l.bays) || l.aisles.length * l.bays > 2000) fail('El plano admite hasta 2.000 ubicaciones.');
    const codes = new Set();
    for (const [id, p] of products.entries()) {
      if (!p || p.id !== id || typeof p.code !== 'string' || !p.code.trim() || codes.has(p.code.toUpperCase()) || typeof p.name !== 'string' || !p.name.trim() || !Number.isInteger(p.family) || p.family < 0 || p.family >= data.spec.groups.length) fail('Catálogo inválido: revisa IDs consecutivos, códigos únicos, nombres y familias.');
      codes.add(p.code.toUpperCase());
    }
    if (!data.spec.groups.every(g => typeof g === 'string' && g.trim())) fail('Las familias deben tener nombre.');
    if (!Array.isArray(data.orders) || !data.orders.length || data.orders.length > 20000) fail('Se admiten entre 1 y 20.000 pedidos.');
    const ids = new Set();
    for (const o of data.orders) {
      if (!o || !['string', 'number'].includes(typeof o.id) || !String(o.id).trim() || ids.has(String(o.id)) || !Array.isArray(o.items) || !o.items.length || o.items.length > 500 || new Set(o.items).size !== o.items.length || !o.items.every(id => Number.isInteger(id) && id >= 0 && id < products.length)) fail('Pedido inválido: revisa IDs únicos y referencias al catálogo.');
      ids.add(String(o.id));
    }
    const rules = data.rules;
    if (!rules || !Array.isArray(rules.pinned) || !rules.pinned.every(id => Number.isInteger(id) && id >= 0 && id < products.length) || !Number.isInteger(rules.maxMoves) || rules.maxMoves < 0 || rules.maxMoves > products.length) fail('Reglas inválidas: incluye maxMoves y pinned.');
    const engine = Base.createInstance(data.spec);
    if (!Array.isArray(data.initial) || !engine.valid(data.initial, data.initial, rules)) fail('La distribución inicial no cumple las ubicaciones, reservas o zonas.');
    return { engine, assignment: [...data.initial], orders: data.orders, rules };
  }
  function bindToDesign(checked,config,Operation,sourcePositions) {
    const source=checked.engine,target=Operation.create(config,{mode:'completa',products:source.products,groups:source.groups});
    const spec=source.layout.spec;
    const coordinates=sourcePositions||source.layout.slots.map(s=>({
      x:s.x??spec.corridors?.[s.aisle]??s.aisle*(spec.aisleSpacing||1),
      z:s.z??s.bay,y:s.y??s.level*(spec.levelCost||1)
    }));
    function normalized(points){
      const axes=['x','y','z'],bounds=axes.map(k=>[Math.min(...points.map(p=>p[k])),Math.max(...points.map(p=>p[k]))]);
      return points.map(p=>axes.map((k,i)=>(p[k]-bounds[i][0])/(bounds[i][1]-bounds[i][0]||1)));
    }
    const from=normalized(coordinates),to=normalized(target.slots),mapping=new Map(),free=new Set(target.engine.layout.assignable);
    source.layout.reserved.forEach(s=>mapping.set(s,target.engine.layout.reserved[0]));
    // Occupied locations take priority; then map unused source positions as space permits.
    const order=[...checked.assignment,...source.layout.assignable.filter(s=>!checked.assignment.includes(s))];
    for(const s of order){
      if(!free.size)break;
      let best=-1,cost=Infinity;
      for(const t of free){const d=from[s].reduce((sum,v,k)=>sum+(v-to[t][k])**2,0);if(d<cost){best=t;cost=d;}}
      mapping.set(s,best);free.delete(best);
    }
    const assignment=checked.assignment.map(s=>mapping.get(s));
    const zones=source.zones(checked.rules).map(zone=>{
      const names=source.layout.slots.filter(s=>(!zone.aisles||zone.aisles.includes(spec.aisles?.[s.aisle]||s.aisleName))&&(!zone.levels||zone.levels.includes(s.level+1))&&(!zone.slots||zone.slots.includes(s.name)))
        .map(s=>mapping.get(s.index)).filter(t=>t!==undefined&&!target.engine.layout.reserved.includes(t)).map(t=>target.engine.slotName(t));
      return {id:zone.id,label:zone.label,families:zone.families,products:zone.products,slots:names};
    });
    const rules={...checked.rules,cleaningZone:false,zones};
    if(!target.engine.valid(assignment,assignment,rules))throw new Error('No se pudieron aplicar las reglas a las ubicaciones del diseño. Revisa sus zonas.');
    return {engine:target.engine,operation:target,assignment,orders:checked.orders,rules};
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { validate,bindToDesign };
  else root.KbitDataset = { validate,bindToDesign };
})(typeof window !== 'undefined' ? window : globalThis);
