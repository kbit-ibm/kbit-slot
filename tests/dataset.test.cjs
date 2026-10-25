'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const E=require('../dist/engine.js');
const {validate}=require('../dist/dataset.js');
const {generate,scenarios}=require('../scripts/generate-data.cjs');
for(const config of scenarios){
 test(config.name+': reproducible, feasible and all products have demand',()=>{
  const stored=require('../data/'+config.name+'/request.json');
  assert.deepEqual(generate(config).request,stored);
  const {engine}=validate(stored,E);
  assert.equal(new Set(stored.orders.flatMap(o=>o.items)).size,config.products);
  assert.ok(engine.valid(stored.initial,stored.initial,stored.rules));
  if(config.products<=30){
   const csv=fs.readFileSync(path.join(__dirname,'../data',config.name,'orders.csv'),'utf8');
   assert.deepEqual(engine.parseCSV(csv),stored.orders);
   const plan=engine.optimize(stored.initial,stored.orders,stored.rules,{iterations:1000,restarts:2});
   assert.ok(engine.valid(plan.target,stored.initial,stored.rules));
   assert.ok(plan.after<=plan.before);
   const assignment=[...stored.initial];
   for(const task of plan.tasks){
    assert.equal(assignment[task.product],task.from);
    assert.ok(!assignment.includes(task.to));
    assignment[task.product]=task.to;
   }
   assert.deepEqual(assignment,plan.target);
  }
 });
}
test('invalid imports reject unknown products, duplicate codes and occupied reserves',()=>{
 const original=require('../data/demo-30/request.json');
 for(const alter of [
  d=>d.orders[0].items.push(1001),
  d=>d.spec.products[1].code=d.spec.products[0].code,
  d=>d.initial[0]=31,
  d=>d.rules.pinned.push(-1),
  d=>d.spec.layout.bays=1000000
 ]){
  const d=structuredClone(original);alter(d);assert.throws(()=>validate(d,E));
 }
});

test('page imports the complete catalogue and restores it after reload',async()=>{
 const vm=require('node:vm');
 const storage=new Map();let savedDesign=null;
 const M=require('../dist/layout-model.js'),O=require('../dist/operation-model.js');
 const source=fs.readFileSync(path.join(__dirname,'../dist/app.js'),'utf8');
 function boot(){
  const elements=new Map(),events={};
  const el=id=>{
   if(!elements.has(id))elements.set(id,{innerHTML:'',textContent:'',hidden:false,open:false,
    classList:{toggle(){}},setAttribute(){},getAttribute(){return null;},hasAttribute(){return false;},
    addEventListener(name,fn){this[name]=fn;},showModal(){this.open=true;},close(){this.open=false;}});
   return elements.get(id);
  };
  const document={getElementById:el,documentElement:el('html'),querySelectorAll:()=>[],querySelector:()=>null,
   addEventListener(name,fn){(events[name]??=[]).push(fn);}};
  const localStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)};
  let latestVisual;
  const window={KbitEngine:E,KbitDataset:require('../dist/dataset.js'),KbitExactSelection:require('../dist/exact-selection.js'),KbitOperation:O,KbitLayout:M,KbitDesigner:{saved:()=>savedDesign,plan:()=>'<svg></svg>'},
   KbitVisual:{panel(props){latestVisual=props;return props.flat;},mount(){return {destroy(){}};}},
   addEventListener(){},scrollTo(){}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../dist/operation-ui.js'),'utf8'),{window});
  vm.runInNewContext(source,{window,document,localStorage,location:{hash:'#almacen'},Intl,JSON,console,
   setTimeout:()=>1,clearTimeout(){},matchMedia:()=>({matches:false,addEventListener(){}})});
  return {el,visual:()=>latestVisual,click(action){for(const fn of events.click)fn({target:{closest:()=>({dataset:{action}})}});}};
 }
 const page=boot();page.click('import');
 assert.match(page.el('modal-content').innerHTML,/Importar operación completa/);
 page.click('import-operation');
 const text=fs.readFileSync(path.join(__dirname,'../data/almacen-1000/request.json'),'utf8');
 await page.el('operation-file').change({target:{files:[{name:'almacen-1000.json',size:Buffer.byteLength(text),text:async()=>text}]}});
 assert.match(page.el('workspace').innerHTML,/1[.,\s]?000/);
 assert.match(page.el('workspace').innerHTML,/D280/);
 assert.equal(page.visual().imported,true);
 assert.equal(page.visual().engine.products.length,1000);
 const saved=JSON.parse(storage.get('kbit-slot-imported-operation-v1'));
 assert.equal(saved.dataset.spec.products.length,1000);
 assert.equal(saved.orders.length,10000);
 const reloaded=boot();
 assert.match(reloaded.el('workspace').innerHTML,/almacen-1000.json/);
 assert.match(reloaded.el('workspace').innerHTML,/D280/);
 assert.equal(reloaded.visual().imported,true);
 savedDesign=M.fromPreset('flying-v');
 const migrated=boot();
 assert.equal(migrated.visual().physical.config.geometry,'flying-v');
 assert.equal(migrated.visual().engine.layout.spec.kind,'network');
 const bound=JSON.parse(storage.get('kbit-slot-imported-operation-v1'));
 assert.equal(bound.dataset.design.geometry,'flying-v');
 assert.equal(bound.orders.length,10000);
 const restored=boot();
 assert.equal(restored.visual().physical.config.geometry,'flying-v');
 assert.deepEqual(JSON.parse(storage.get('kbit-slot-imported-operation-v1')).assignment,bound.assignment);
 savedDesign=M.fromPreset('chevron');
 const changed=boot();
 assert.equal(changed.visual().physical.config.geometry,'chevron');
 assert.equal(changed.visual().engine.products.length,1000);
 savedDesign={...M.fromPreset('parallel'),aisles:1,bays:2,levels:1,positions:1};
 const tooSmall=boot();
 assert.match(tooSmall.el('workspace').innerHTML,/necesitas al menos 1001/);
 assert.equal(JSON.parse(storage.get('kbit-slot-imported-operation-v1')).dataset.design.geometry,'chevron');

});

test('imported 3D coordinates are unique and routes match engine distances',async()=>{
 const {importedLayout}=await import('../src/imported-layout.mjs');
 for(const name of ['milp-8','almacen-1000']){
  const d=require('../data/'+name+'/request.json'),engine=E.createInstance(d.spec),layout=importedLayout(engine);
  assert.equal(new Set(engine.layout.slots.map(s=>JSON.stringify(layout.point(s.index)))).size,engine.layout.slotCount);
  const slots=[0,1,engine.layout.spec.bays-1,engine.layout.spec.bays,engine.layout.slotCount-1];
  for(const a of slots)for(const b of slots){
   const route=layout.route(a,b);
   assert.deepEqual(route[0],layout.point(a));assert.deepEqual(route.at(-1),layout.point(b));
   const length=route.reduce((sum,p,i)=>i?sum+Math.hypot(p.x-route[i-1].x,p.z-route[i-1].z):0,0);
   assert.ok(Math.abs(length-engine.distance(a,b))<1e-6);
  }
 }
});

test('imported visual panel provides 3D, plan and sector controls for all 1000 products',()=>{
 const vm=require('node:vm'),window={};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../dist/visual-ui.js'),'utf8'),{window});
 const d=require('../data/almacen-1000/request.json');
 const html=window.KbitVisual.panel({engine:E.createInstance(d.spec),assignment:d.initial,orders:d.orders,pinned:[],imported:true,flat:'<p>Plano de prueba</p>'});
 assert.match(html,/data-vaction="3d"/);assert.match(html,/data-vaction="2d"/);
 assert.match(html,/id="scene-sector"/);assert.match(html,/Sector 12/);
 assert.match(html,/SKU-1000/);assert.match(html,/Plano de prueba/);
});

test('1000 imported products retain every saved geometry and its physical metric',()=>{
 const M=require('../dist/layout-model.js'),O=require('../dist/operation-model.js'),D=require('../dist/dataset.js');
 const data=require('../data/almacen-1000/request.json');
 for(const geometry of ['parallel','flying-v','fishbone','chevron']){
  const config=M.fromPreset(geometry),original=structuredClone(config);
  const bound=D.bindToDesign(D.validate(data,E),config,O);
  assert.deepEqual(config,original);
  assert.equal(O.fingerprint(bound.operation.config),O.fingerprint(original));
  assert.equal(bound.engine.layout.slotCount,M.summary(config).locations);
  assert.deepEqual(bound.engine.products,data.spec.products);
  assert.equal(bound.engine.valid(bound.assignment,bound.assignment,bound.rules),true);
  const id=999,slot=bound.assignment[id],location=bound.operation.slots[slot];
  assert.equal(bound.engine.slotName(slot),location.name);
  assert.equal(M.slotCode(config,location.rack,location.level,location.position),location.name);
  assert.ok(M.racks(config,location.sector).some(r=>r.x===location.rack.x&&r.z===location.rack.z&&r.rotation===location.rack.rotation));
  const reconstructed=E.createInstance(bound.engine.spec);
  assert.equal(reconstructed.distance(bound.assignment[0],bound.assignment[999]),bound.engine.distance(bound.assignment[0],bound.assignment[999]));
  const path=bound.operation.route(bound.assignment[0],slot);
  assert.equal(path[0].x,bound.operation.slots[bound.assignment[0]].x);
  assert.equal(path.at(-1).z,location.z);
 }
});
