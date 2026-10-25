'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const E=require('../dist/engine.js'),S=require('../dist/exact-selection.js');
const data=require('../data/almacen-1000/request.json');
test('maxMoves 14 still leaves 999 candidates, explicit selection fixes the other 986',()=>{
 const engine=E.createInstance(data.spec),rules={...data.rules,maxMoves:14};
 assert.equal(S.candidates(engine,rules).length,999);
 const chosen=Array.from({length:14},(_,i)=>i+1),prepared=S.prepare(engine,data.initial,rules,chosen);
 assert.equal(prepared.pinned.length,986);
 assert.deepEqual(S.candidates(engine,prepared),chosen);
 assert.equal(prepared.maxMoves,14);
 assert.ok(engine.valid(data.initial,data.initial,prepared));
 const description=engine.describe(data.initial,data.orders,prepared);
 const taken=new Set(prepared.pinned.map(id=>data.initial[id]));
 const sizes=chosen.map(id=>description.allowed[id].filter(slot=>!taken.has(slot)).length);
 const variables=sizes.reduce((a,b)=>a+b,0)+sizes.reduce((sum,n,i)=>sum+sizes.slice(i+1).reduce((a,b)=>a+n*b,0),0);
 assert.ok(variables<=120000,variables+' variables');
});
test('selection preserves existing zones and can be edited without accumulating scopes',()=>{
 const engine=E.createInstance(data.spec),first=S.prepare(engine,data.initial,data.rules,[1,2,3]);
 const second=S.prepare(engine,data.initial,first,[4,5],true);
 assert.equal(second.zones.filter(z=>z.id===S.SCOPE).length,1);
 assert.ok(second.zones.some(z=>z.id==='limpieza'));
 assert.deepEqual(S.candidates(engine,second),[4,5]);
 const unrestricted=S.prepare(engine,data.initial,second,[4,5],false);
 assert.ok(!unrestricted.zones.some(z=>z.id===S.SCOPE));
 assert.throws(()=>S.prepare(engine,data.initial,data.rules,[]));
 assert.throws(()=>S.prepare(engine,data.initial,data.rules,Array.from({length:15},(_,i)=>i)));
});
