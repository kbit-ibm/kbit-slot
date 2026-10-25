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
 const storage=new Map();
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
  const window={KbitEngine:E,KbitDataset:{validate},KbitDesigner:{saved:()=>null},addEventListener(){},scrollTo(){}};
  vm.runInNewContext(source,{window,document,localStorage,location:{hash:'#almacen'},Intl,JSON,console,
   setTimeout:()=>1,clearTimeout(){},matchMedia:()=>({matches:false,addEventListener(){}})});
  return {el,click(action){for(const fn of events.click)fn({target:{closest:()=>({dataset:{action}})}});}};
 }
 const page=boot();page.click('import');
 assert.match(page.el('modal-content').innerHTML,/Importar operación completa/);
 page.click('import-operation');
 const text=fs.readFileSync(path.join(__dirname,'../data/almacen-1000/request.json'),'utf8');
 await page.el('operation-file').change({target:{files:[{name:'almacen-1000.json',size:Buffer.byteLength(text),text:async()=>text}]}});
 assert.match(page.el('workspace').innerHTML,/1[.,\s]?000/);
 assert.match(page.el('workspace').innerHTML,/D280/);
 const saved=JSON.parse(storage.get('kbit-slot-imported-operation-v1'));
 assert.equal(saved.dataset.spec.products.length,1000);
 assert.equal(saved.orders.length,10000);
 const reloaded=boot();
 assert.match(reloaded.el('workspace').innerHTML,/almacen-1000.json/);
 assert.match(reloaded.el('workspace').innerHTML,/D280/);
});
