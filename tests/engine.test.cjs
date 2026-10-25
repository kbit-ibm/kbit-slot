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
  for(const [maxMoves,after] of [[0,4454],[2,4100],[4,3780],[6,3482],[8,3256],[12,3059],[30,2722]])assert.equal(E.optimize(assignment,orders,{maxMoves,pinned:[10],cleaningZone:true}).after,after);
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
