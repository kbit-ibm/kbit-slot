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
