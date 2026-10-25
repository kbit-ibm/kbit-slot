const test=require('node:test');
const assert=require('node:assert/strict');
const E=require('../dist/engine.js');

test('demo: 30 productos distintos, 180 pedidos y reserva D08 libre',()=>{
  const data=E.demo();assert.equal(data.assignment.length,30);assert.equal(new Set(data.assignment).size,30);assert.equal(data.orders.length,180);assert.equal(data.assignment.includes(31),false);
  assert.equal(E.valid(data.assignment,data.assignment,{maxMoves:0,pinned:[],cleaningZone:true}),true);
});

test('el plan mejora el índice y cumple límites, productos fijos y zonas',()=>{
  const {assignment,orders}=E.demo();
  for(const maxMoves of [2,4,6,8,12]){
    const rules={maxMoves,pinned:[10,0],cleaningZone:true};const plan=E.optimize(assignment,orders,rules);
    assert(plan.after<=plan.before);assert(plan.moved<=maxMoves);assert.equal(plan.target[10],assignment[10]);assert.equal(plan.target[0],assignment[0]);assert.equal(E.valid(plan.target,assignment,rules),true);
    for(const p of E.products.filter(p=>p.family===2))assert.equal(Math.floor(plan.target[p.id]/8),3);
  }
});

test('las tareas se ejecutan sin destinos ocupados y alcanzan la propuesta',()=>{
  const {assignment,orders}=E.demo();const plan=E.optimize(assignment,orders,{maxMoves:8,pinned:[10],cleaningZone:true});assert(plan.tasks.length>0);let current=[...assignment];
  for(const task of plan.tasks){assert.equal(current.includes(task.to),false);current=E.confirmTask(current,task);assert.equal(new Set(current).size,30);if(E.products[task.product].family===2)assert.equal(Math.floor(task.to/8),3);}
  assert.deepEqual(current,plan.target);assert.deepEqual(assignment,E.demo().assignment);
});

test('un intercambio cíclico usa un espacio temporal y tres pasos válidos',()=>{
  const initial=Array.from({length:30},(_,i)=>i),target=[...initial];[target[0],target[1]]=[target[1],target[0]];
  const tasks=E.makeTasks(initial,target);assert.equal(tasks.length,3);assert.equal(tasks[0].temporary,true);assert.equal(tasks[0].to,31);let current=initial;for(const task of tasks)current=E.confirmTask(current,task);assert.deepEqual(current,target);
});

test('todos los productos fijos producen cero movimientos',()=>{
  const {assignment,orders}=E.demo();const plan=E.optimize(assignment,orders,{maxMoves:12,pinned:E.products.map(p=>p.id),cleaningZone:true});assert.equal(plan.tasks.length,0);assert.equal(plan.improvement,0);
});

test('un destino ocupado y una tarea ya confirmada se rechazan',()=>{
  const initial=Array.from({length:30},(_,i)=>i);assert.throws(()=>E.confirmTask(initial,{product:0,from:0,to:1,done:false}));assert.throws(()=>E.confirmTask(initial,{product:0,from:0,to:31,done:true}));
});

test('CSV: BOM, punto y coma, comillas, agrupación y productos repetidos',()=>{
  const orders=E.parseCSV('\uFEFForder_id;sku\r\n"PED;1";"SKU-001"\r\n"PED;1";SKU-006\r\n"PED;1";SKU-001\r\nPED-2;sku-003\r\n');
  assert.equal(orders.length,2);assert.deepEqual(orders[0],{id:'PED;1',items:[0,5]});assert.deepEqual(orders[1].items,[2]);
  const matrix=E.flow(orders);assert.equal(matrix[0][5],1);assert.equal(matrix[5][0],1);
});

test('CSV: errores de cabecera, SKU desconocido y comillas abiertas',()=>{
  assert.throws(()=>E.parseCSV('pedido,producto\n1,SKU-001'),/cabecera/);assert.throws(()=>E.parseCSV('order_id,sku\n1,SKU-999'),/desconocido/);assert.throws(()=>E.parseCSV('order_id,sku\n"1,SKU-001'),/comillas/);
});

test('las distancias usan pasillos transversales y son simétricas',()=>{
  assert.equal(E.distance(0,7),7);assert.equal(E.distance(0,8),6);assert.equal(E.distance(7,15),6);assert.equal(E.distance(4,4),0);for(let a=0;a<32;a++)for(let b=0;b<32;b++)assert.equal(E.distance(a,b),E.distance(b,a));
});

test('plano por defecto: numeración histórica, reserva D08 y 31 posiciones asignables',()=>{
  assert.equal(E.layout.slotCount,32);assert.equal(E.slotName(0),'A01');assert.equal(E.slotName(31),'D08');assert.equal(E.layout.slotIndex('C05'),20);
  assert.deepEqual(E.layout.reserved,[31]);assert.equal(E.layout.assignable.length,31);assert.deepEqual(E.layout.spec,{version:1,aisles:['A','B','C','D'],bays:8,levels:1,aisleSpacing:4,levelCost:1,reserved:['D08']});
});

test('plano de dos niveles: nombres con nivel, costo vertical y misma demo en el piso',()=>{
  const I=E.createInstance({layout:{levels:2}}),base=E.demo(),data=I.demo();
  assert.equal(I.layout.slotCount,64);assert.equal(I.slotName(0),'A01-1');assert.equal(I.slotName(1),'A01-2');assert.deepEqual(I.layout.spec.reserved,['D08-1']);
  assert.equal(I.distance(0,1),1);assert.equal(I.distance(0,17),E.distance(0,8)+1);
  for(let a=0;a<64;a++)for(let b=0;b<64;b++)for(const c of [0,21,63])assert(I.distance(a,b)<=I.distance(a,c)+I.distance(c,b));
  assert.deepEqual(data.orders,base.orders);assert.deepEqual(data.assignment.map(I.slotName),base.assignment.map(slot=>E.slotName(slot)+'-1'));
  const rules={maxMoves:6,pinned:[10],cleaningZone:true},plan=I.optimize(data.assignment,data.orders,rules);
  assert.equal(plan.before,E.optimize(base.assignment,base.orders,rules).before);assert(plan.after<plan.before);assert.equal(I.valid(plan.target,data.assignment,rules),true);
});

test('zonas: la casilla de limpieza equivale a la zona genérica y los filtros se combinan',()=>{
  const {assignment,orders}=E.demo(),legacy={maxMoves:8,pinned:[],cleaningZone:true},generic={maxMoves:8,pinned:[],zones:[E.CLEANING_ZONE]};
  assert.deepEqual(E.optimize(assignment,orders,legacy).target,E.optimize(assignment,orders,generic).target);
  assert.deepEqual(E.zones({cleaningZone:true,zones:[]}),[]);
  const I=E.createInstance({layout:{levels:2}}),data=I.demo(),zones=[{id:'pesados',families:[5],levels:[1]},{id:'limpieza',families:[2],aisles:['D']}];
  const plan=I.optimize(data.assignment,data.orders,{maxMoves:12,pinned:[],zones});
  for(const p of I.products){const slot=I.layout.slots[plan.target[p.id]];if(p.family===5)assert.equal(slot.level,0);if(p.family===2)assert.equal(slot.aisle,3);}
  assert.throws(()=>E.valid(assignment,assignment,{zones:[{label:'Fríos',families:[0],aisles:['Z']}]}),/Fríos.*Z/);
  assert.throws(()=>I.valid(data.assignment,data.assignment,{zones:[{id:'alto',families:[0],levels:[3]}]}),/nivel 3/);
  assert.throws(()=>E.optimize(assignment,orders,{maxMoves:4,pinned:[],zones:[{families:[0],aisles:['A']}]}),/no cumple las reglas/);
});

test('plano y catálogo inválidos se rechazan con mensajes claros',()=>{
  assert.throws(()=>E.createLayout({aisles:['A','A']}),/únicos/);assert.throws(()=>E.createLayout({levels:0}),/enteros positivos/);
  assert.throws(()=>E.createLayout({reserved:['Z99']}),/Z99/);assert.throws(()=>E.createInstance({layout:{aisles:['A'],bays:8,reserved:[]}}),/más productos/);
});

test('costo incremental: mover e intercambiar coinciden con recalcular el índice completo',()=>{
  for(const I of [E,E.createInstance({layout:{levels:2,levelCost:1.5}})]){
    const {assignment,orders}=I.demo(),matrix=I.flow(orders),base=I.cost(assignment,matrix);let checked=0;
    for(let a=0;a<30;a+=3){
      for(let b=a+1;b<30;b+=4){const swapped=[...assignment];[swapped[a],swapped[b]]=[swapped[b],swapped[a]];assert(Math.abs(I.deltaSwap(assignment,matrix,a,b)-(I.cost(swapped,matrix)-base))<1e-9);checked++;}
      for(const slot of I.layout.assignable.filter(slot=>!assignment.includes(slot))){const moved=[...assignment];moved[a]=slot;assert(Math.abs(I.deltaMove(assignment,matrix,a,slot)-(I.cost(moved,matrix)-base))<1e-9);checked++;}
    }
    assert(checked>50);
  }
});

test('la búsqueda voraz reproduce los resultados del motor anterior',()=>{
  const {assignment,orders}=E.demo();
  for(const [maxMoves,after] of [[0,4454],[2,4100],[4,3780],[6,3482],[8,3256],[12,3059],[30,2722]]){const plan=E.optimize(assignment,orders,{maxMoves,pinned:[10],cleaningZone:true},{iterations:0});assert.equal(plan.after,after);assert.equal(plan.solver.id,'voraz');}
});

test('cálculo por tramos y asíncrono: mismo plan que optimize, con progreso y cancelación',async()=>{
  const {assignment,orders}=E.demo(),rules={maxMoves:8,pinned:[10],cleaningZone:true},reference=E.optimize(assignment,orders,rules);
  const solver=E.createSolver(assignment,orders,rules);let state,slices=0;do{state=solver.step(0);slices++;}while(!state.done);
  assert(slices>1);assert.equal(state.progress,1);assert.deepEqual(solver.result().target,reference.target);
  const updates=[];const plan=await E.solveAsync(assignment,orders,rules,{onProgress:s=>updates.push(s)});
  assert.deepEqual(plan.target,reference.target);assert.equal(plan.after,reference.after);assert(updates.length>0);assert.equal(updates.at(-1).done,true);
  const controller=new AbortController();controller.abort();
  await assert.rejects(E.solveAsync(assignment,orders,rules,{signal:controller.signal}),{name:'AbortError'});
  await assert.rejects(E.solveAsync(assignment,orders,{maxMoves:4,pinned:[],zones:[{families:[0],aisles:['A']}]}),/no cumple las reglas/);
  assert.throws(()=>E.createSolver(assignment,orders,rules).result(),/no terminó/);
});

test('recocido: nunca peor que la búsqueda voraz, cumple las reglas y es reproducible con la misma semilla',()=>{
  const {assignment,orders}=E.demo();
  for(const maxMoves of [2,4,8,12,30])for(const cleaningZone of [true,false]){
    const rules={maxMoves,pinned:[10],cleaningZone},plan=E.optimize(assignment,orders,rules);
    assert(plan.after<=plan.solver.greedy);assert.equal(plan.solver.greedy,E.optimize(assignment,orders,rules,{iterations:0}).after);
    assert.equal(E.valid(plan.target,assignment,rules),true);assert(plan.moved<=maxMoves);assert.equal(plan.after,E.cost(plan.target,E.flow(orders)));
    if(maxMoves>=8)assert(plan.after<plan.solver.greedy,'debe mejorar a la búsqueda voraz con '+maxMoves+' movimientos');
    let current=[...assignment];for(const task of plan.tasks)current=E.confirmTask(current,task);assert.deepEqual(current,plan.target);
  }
  const rules={maxMoves:12,pinned:[10],cleaningZone:true},a=E.optimize(assignment,orders,rules,{seed:7}),b=E.optimize(assignment,orders,rules,{seed:7});
  assert.deepEqual(a.target,b.target);assert.equal(a.solver.label,'Voraz + recocido simulado');assert.equal(a.solver.iterations,E.SOLVER_DEFAULTS.iterations*E.SOLVER_DEFAULTS.restarts);
});

test('recocido: límite de tiempo, opciones inválidas y cancelación a mitad de cálculo',async()=>{
  const {assignment,orders}=E.demo(),rules={maxMoves:12,pinned:[],cleaningZone:true};
  const capped=E.optimize(assignment,orders,rules,{iterations:5000000,restarts:4,timeLimit:30});
  assert.equal(capped.solver.timeLimited,true);assert(capped.solver.iterations<20000000);assert.equal(E.valid(capped.target,assignment,rules),true);assert(capped.after<=capped.solver.greedy);
  assert.throws(()=>E.optimize(assignment,orders,rules,{iterations:-1}),/opciones del cálculo/);assert.throws(()=>E.optimize(assignment,orders,rules,{restarts:0}),/opciones del cálculo/);
  const controller=new AbortController();let phases=new Set();
  const pending=E.solveAsync(assignment,orders,rules,{iterations:5000000,restarts:4,signal:controller.signal,onProgress:s=>{phases.add(s.phase);if(s.phase==='recocido')controller.abort();}});
  await assert.rejects(pending,{name:'AbortError'});assert(phases.has('recocido'));
});

test('problema exportado y planes externos: mismas reglas, índice recalculado y propuestas inválidas descartadas',()=>{
  const {assignment,orders}=E.demo(),rules={maxMoves:6,pinned:[10],cleaningZone:true},problem=E.describe(assignment,orders,rules);
  assert.equal(problem.products,30);assert.equal(problem.slots,32);assert.equal(problem.maxMoves,6);assert.deepEqual(problem.pinned,[10]);assert.equal(problem.cost,4454);
  assert.equal(problem.distances[0][8],6);assert.deepEqual(problem.allowed[10],[24,25,26,27,28,29,30]);assert.equal(problem.allowed[0].includes(31),false);
  assert.equal(JSON.parse(JSON.stringify(problem)).flow[0][1],problem.flow[0][1]);
  const reference=E.optimize(assignment,orders,rules),plan=E.planFrom(assignment,orders,rules,reference.target,{id:'externo',label:'Prueba'});
  assert.equal(plan.after,reference.after);assert.deepEqual(plan.tasks,reference.tasks);assert.equal(plan.solver.id,'externo');
  const pinnedMoved=[...assignment];[pinnedMoved[10],pinnedMoved[11]]=[pinnedMoved[11],pinnedMoved[10]];
  for(const bad of [null,[1,2],pinnedMoved,assignment.map(()=>0)])assert.throws(()=>E.planFrom(assignment,orders,rules,bad),/se descartó/);
  assert.equal(E.describe(assignment,orders,{pinned:[]}).maxMoves,null);
});

test('plano por pasillos: distancia por el pasillo o por el cruce más corto, más nivel y acceso al estante',()=>{
  const slots=[{name:'A1',aisle:0,z:0,level:0},{name:'A2',aisle:0,z:6,level:0},{name:'A2-alto',aisle:0,z:6,level:2},{name:'B1',aisle:1,z:0,level:0},{name:'B2',aisle:1,z:9,level:0}];
  const L=E.createLayout({kind:'corridors',aisles:['P01','P02'],corridors:[0,5],crossings:[-2,10],levelCost:1.5,accessCost:2,slots});
  assert.equal(L.distance(0,0),0);assert.equal(L.distance(0,1),6+2);assert.equal(L.distance(1,2),3+2);assert.equal(L.distance(0,3),5+4+2);
  assert.equal(L.distance(1,4),5+(4+1)+2,'por el cruce del frente (z = 10), no por el de atrás');
  for(let a=0;a<5;a++)for(let b=0;b<5;b++)assert.equal(L.distance(a,b),L.distance(b,a));
  assert.equal(L.spec.levels,3);assert.equal(L.slotIndex('B2'),4);
  assert.throws(()=>E.createLayout({kind:'corridors',aisles:['P01'],corridors:[0],crossings:[0],slots:[{name:'x',aisle:3,z:0,level:0}]}),/no es válida/);
  assert.throws(()=>E.createLayout({kind:'corridors',aisles:['P01'],corridors:[0],crossings:[0],slots:[{name:'x',aisle:0,z:0,level:0},{name:'x',aisle:0,z:1,level:0}]}),/repite/);
  assert.throws(()=>E.createLayout({kind:'corridors',aisles:['P01'],corridors:[0],crossings:[],slots}),/cruce/);
});

// A small warehouse whose optimum can be enumerated: 6 products in 8 slots (20 160 placements).
function tiny(seed = 7) {
  let state=seed;const random=()=>(state=(state*1103515245+12345)%2147483648)/2147483648;
  const products=Array.from({length:6},(_,id)=>({id,sku:'P'+id,name:'Producto '+id,family:id%2}));
  const I=E.createInstance({layout:{aisles:['A','B'],bays:4,reserved:[]},products,groups:['Ligero','Pesado']});
  const orders=Array.from({length:40},(_,k)=>({id:'O'+k,items:[...new Set(Array.from({length:2+Math.floor(random()*3)},()=>Math.floor(random()*6)))]}));
  return { I, orders, initial:[0,1,2,3,4,5] };
}
function bruteForce(I, initial, orders, rules) {
  const matrix=I.flow(orders);let best=Infinity;const current=[];
  const visit=used=>{
    if(current.length===6){ if(I.valid(current,initial,rules))best=Math.min(best,I.cost(current,matrix));return; }
    for(const slot of I.layout.assignable)if(!used.has(slot)){ used.add(slot);current.push(slot);visit(used);current.pop();used.delete(slot); }
  };
  visit(new Set());return best;
}

test('cota inferior: nunca supera el óptimo exacto, con límite de movimientos, fijos y zonas, y acota la brecha del plan',()=>{
  for(const seed of [3,7,11]){
    const {I,orders,initial}=tiny(seed);
    for(const rules of [{pinned:[]},{maxMoves:1,pinned:[]},{maxMoves:2,pinned:[]},{maxMoves:3,pinned:[0]},{maxMoves:1,pinned:[2]},{pinned:[1],zones:[{id:'pesados',families:[1],aisles:['B']}]}]){
      if(!I.valid(initial,initial,rules))continue;
      const optimum=bruteForce(I,initial,orders,rules),bound=I.lowerBound(initial,orders,rules),plan=I.optimize(initial,orders,rules,{iterations:2000,restarts:2});
      assert.ok(bound.value<=optimum+1e-9,`semilla ${seed}, reglas ${JSON.stringify(rules)}: cota ${bound.value} > óptimo ${optimum}`);
      assert.ok(bound.value>0);assert.ok(plan.after>=optimum-1e-9);
      assert.equal(plan.bound.value,bound.value);assert.ok(Math.abs(plan.bound.gap-(plan.after-bound.value)/bound.value*100)<1e-9);
    }
  }
  // Few moves: the bound from the current index minus the largest possible savings wins; many moves: the Lagrangian one.
  const {assignment,orders}=E.demo(),rules=maxMoves=>({maxMoves,pinned:[10],cleaningZone:true}),free=E.lowerBound(assignment,orders,{pinned:[10],cleaningZone:true});
  const few=E.lowerBound(assignment,orders,rules(2)),many=E.lowerBound(assignment,orders,rules(12));
  assert.match(few.method,/Límite de movimientos/);assert.match(many.method,/lagrangiano/);
  for(const bound of [few,many])assert.ok(bound.value>=free.value-1e-9,'el límite de movimientos solo puede subir la cota');
  assert.equal(E.optimize(assignment,orders,{maxMoves:4},{bound:false}).bound,null);assert.equal(E.planFrom(assignment,orders,{},assignment).bound,null);
});

test('secuencia de tareas: un paso por producto más uno por ciclo, sin destinos ocupados y sin cambio de orden que acorte el recorrido vacío',()=>{
  const {assignment,orders}=E.demo();
  for(const rules of [{maxMoves:8,pinned:[10],cleaningZone:true},{pinned:[]}]){
    const plan=E.optimize(assignment,orders,rules);let cycles=0;const seen=new Set(),holder=new Map(assignment.map((slot,id)=>[slot,id]));
    for(let id=0;id<30;id++){ if(seen.has(id) || assignment[id]===plan.target[id])continue;let at=id;const path=new Set();
      while(at!==undefined && !seen.has(at) && !path.has(at)){ path.add(at);at=holder.get(plan.target[at]); }
      if(at!==undefined && path.has(at))cycles++;path.forEach(p=>seen.add(p)); }
    assert.equal(plan.tasks.length,plan.moved+cycles);assert.equal(plan.metrics.relocation.temporary,cycles);
    let current=[...assignment],last=null,empty=0;
    for(const task of plan.tasks){ if(last!==null)empty+=E.distance(last,task.from);assert.equal(current.includes(task.to),false);current=E.confirmTask(current,task);last=task.to; }
    assert.deepEqual(current,plan.target);assert.ok(Math.abs(plan.metrics.relocation.empty-empty)<1e-9);assert.deepEqual(plan.tasks.map(t=>t.id),plan.tasks.map((_,k)=>k+1));
    const walk=list=>list.slice(1).reduce((sum,t,k)=>sum+E.distance(list[k].to,t.from),0);
    const runs=list=>{ let at=[...assignment];for(const t of list){ if(at[t.product]!==t.from || at.includes(t.to))return false;at=E.confirmTask(at,t); }return true; };
    for(let i=0;i<plan.tasks.length;i++)for(let j=0;j<plan.tasks.length;j++)if(i!==j){
      const trial=[...plan.tasks],[task]=trial.splice(i,1);trial.splice(j,0,task);
      if(runs(trial))assert.ok(walk(trial)>=empty-1e-9,'mover la tarea '+(i+1)+' a la posición '+(j+1)+' acorta el recorrido');
    }
  }
});

test('métricas operativas: recorrido de picking desde empaque, pares y productos que más mejoran y traza de convergencia',()=>{
  const {assignment,orders}=E.demo(),plan=E.optimize(assignment,orders,{pinned:[]}),m=plan.metrics,matrix=E.flow(orders);
  assert.equal(m.unit,'u');assert.equal(m.picking.fromPacking,true);assert.equal(m.picking.orders,180);assert.ok(m.picking.after<m.picking.before);
  assert.ok(Math.abs(m.picking.change-(m.picking.before-m.picking.after)/m.picking.before*100)<1e-9);
  const p=m.bestPairs[0];assert.equal(p.gain,matrix[p.a][p.b]*(E.distance(assignment[p.a],assignment[p.b])-E.distance(plan.target[p.a],plan.target[p.b])));
  for(let k=1;k<m.bestPairs.length;k++)assert.ok(m.bestPairs[k-1].gain>=m.bestPairs[k].gain);
  // An order with one product goes from packing to its slot and back.
  const single=E.optimize(assignment,[{id:'x',items:[3]},{id:'y',items:[3,4]}],{maxMoves:0,pinned:[]},{iterations:0});
  assert.ok(single.metrics.picking.before>=2*E.layout.depotDistance(assignment[3]));
  const trace=plan.solver.trace;assert.equal(trace[0].phase,'inicio');assert.equal(trace[0].index,plan.before);assert.equal(trace.at(-1).index,plan.after);
  for(let k=1;k<trace.length;k++){ assert.ok(trace[k].index<=trace[k-1].index);assert.ok(trace[k].evaluations>=trace[k-1].evaluations); }
});
