const {test}=require('node:test'),assert=require('node:assert/strict');
const M=require('../dist/layout-model.js'),O=require('../dist/operation-model.js'),Base=require('../dist/engine.js');
test('all saved geometries provide real, unique, bounded operational addresses',()=>{
 for(const p of M.presets){const r=O.create(M.fromPreset(p.id)),d=r.demo();assert.ok(r.slots.length<=64);assert.equal(new Set(r.slots.map(s=>s.name)).size,r.slots.length);assert.ok(r.engine.valid(d.assignment,d.assignment,{maxMoves:6,pinned:[],zones:[]}));for(const s of r.slots){assert.equal(s.name,M.slotCode(r.config,s.rack,s.level,s.position));assert.ok(r.sectors.some(sec=>sec.id===s.sector));}}
});
test('routes start and finish at the exact shelf and follow clear aisle edges',()=>{
 for(const p of M.presets){const c=M.fromPreset(p.id),r=O.create(c),runs=M.runs(c);
  for(const l of r.graph.lines){const shape=M.pathRect({points:[l.a,l.b],width:.02});assert.ok(!runs.some(rack=>M.intersects(rack,shape)),p.id);for(const point of [l.a,l.b]){assert.ok(Math.abs(point.x)<r.stats.width/2);assert.ok(Math.abs(point.z)<r.stats.depth/2);}}
  for(let i=0;i<r.slots.length;i++){const j=(i+7)%r.slots.length,path=r.route(i,j),a=r.slots[i],b=r.slots[j];assert.deepEqual(path[0],{x:a.x,y:a.y,z:a.z});assert.deepEqual(path.at(-1),{x:b.x,y:b.y,z:b.z});assert.ok(path.every(p=>[p.x,p.y,p.z].every(Number.isFinite)));assert.ok(Math.abs(r.engine.distance(i,j)-r.engine.distance(j,i))<1e-6);}
 }
});
test('wide and steep Chevron circulation fits the saved building, including one-sided racks',()=>{
 for(const sides of [1,2])for(const angle of [30,60]){const r=O.create({...M.fromPreset('chevron'),aisleWidth:6,rackDepth:2,bayWidth:1,sides,angle});for(const l of r.graph.lines)for(const p of [l.a,l.b]){assert.ok(Math.abs(p.x)<=r.stats.width/2);assert.ok(Math.abs(p.z)<=r.stats.depth/2);}}
});
test('plans animate and confirm the same sequential tasks on actual sectors',()=>{
 for(const p of M.presets){const r=O.create(M.fromPreset(p.id)),d=r.demo(),rules={maxMoves:6,pinned:[10],zones:[]},plan=r.decorate(r.engine.optimize(d.assignment,d.orders,rules,{iterations:0}));assert.ok(plan.tasks.length);let current=d.assignment;
  for(const t of plan.tasks){assert.equal(t.fromSector,r.slots[t.from].sector);assert.equal(t.toSector,r.slots[t.to].sector);current=r.engine.confirmTask(current,t);}
  assert.deepEqual(current,plan.target);assert.ok(plan.after<plan.before);assert.deepEqual(r.blocks(plan.tasks).flatMap(b=>b.tasks.map(t=>t.id)),plan.tasks.map(t=>t.id));assert.equal(plan.layoutKey,r.key);
 }
});
test('physical specs reconstruct identically for the Worker and remote bridge',()=>{
 const r=O.create(M.fromPreset('fishbone')),copy=Base.createInstance(JSON.parse(JSON.stringify(r.engine.spec))),d=r.demo(),rules={maxMoves:6,pinned:[10],zones:[]};
 assert.deepEqual(copy.layout.slots.map(s=>s.name),r.slots.map(s=>s.name));assert.equal(copy.cost(d.assignment,copy.flow(d.orders)),r.engine.cost(d.assignment,r.engine.flow(d.orders)));assert.deepEqual(copy.optimize(d.assignment,d.orders,rules,{iterations:0}).target,r.engine.optimize(d.assignment,d.orders,rules,{iterations:0}).target);
});
test('layout identity separates saved operations and ignores renaming only',()=>{
 const a=M.fromPreset('parallel');assert.equal(O.fingerprint(a),O.fingerprint({...a,name:'Otro nombre'}));assert.notEqual(O.fingerprint(a),O.fingerprint({...a,bays:a.bays+1}));assert.notEqual(O.fingerprint(a),O.fingerprint({...a,geometry:'flying-v',template:'flying-v'}));
});
test('small warehouses use a fitting sample and reject an operation without a free position',()=>{
 const c={...M.fromPreset('parallel'),aisles:1,bays:1,levels:1,positions:2,sides:1},r=O.create(c),d=r.demo();assert.equal(r.engine.products.length,1);assert.equal(d.assignment.length,1);assert.ok(d.orders.every(o=>o.items.every(id=>id===0)));assert.throws(()=>O.create({...c,positions:1}),/dos ubicaciones/);
});
test('large warehouse operation bounds its matrix independently of full building capacity',()=>{
 const r=O.create({...M.fromPreset('parallel'),aisles:64,bays:100,levels:12,positions:6,crossEvery:5});assert.equal(r.stats.locations,921600);assert.equal(r.slots.length,64);assert.equal(r.engine.layout.distances.length,64);assert.ok(r.graph.nodes.length<2000);
});
test('malformed physical matrices or duplicate addresses are rejected',()=>{
 const r=O.create(M.fromPreset('parallel')),spec=JSON.parse(JSON.stringify(r.engine.spec));spec.layout.distances[0][1]+=1;assert.throws(()=>Base.createInstance(spec),/simétricas/);
 const other=JSON.parse(JSON.stringify(r.engine.spec));other.layout.slots[1].name=other.layout.slots[0].name;assert.throws(()=>Base.createInstance(other),/repetirse/);
});
