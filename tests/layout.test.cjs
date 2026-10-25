const {test}=require('node:test');
const assert=require('node:assert/strict');
const M=require('../dist/layout-model.js');
const allRacks=c=>M.sectors(c).flatMap(s=>M.racks(c,s.id));

test('four real geometries calculate capacity from the racks that fit',()=>{
  assert.deepEqual(M.presets.map(p=>p.id),['parallel','flying-v','fishbone','chevron']);
  const expected=[144,112,204,192];
  M.presets.forEach((p,i)=>{const c=M.fromPreset(p.id),s=M.summary(c);assert.equal(s.racks,expected[i]);assert.equal(s.locations,s.racks*c.levels*c.positions);assert.equal(allRacks(c).length,s.racks);});
});
test('legacy saved designs migrate to parallel without losing size or addresses',()=>{
  const c=M.normalize({version:1,template:'compact',name:'Guardado',aisles:2,bays:4,levels:3,positions:2,sides:2,aisleWidth:2.4,bayWidth:2.4,rackDepth:1,levelHeight:.75,crossEvery:10});
  assert.equal(c.version,2);assert.equal(c.geometry,'parallel');assert.equal(c.name,'Guardado');assert.equal(M.summary(c).locations,96);
  assert.equal(M.summary(c).width,13.8);assert.equal(M.summary(c).depth,21.6);
  assert.ok(Math.abs(M.racks(c)[0].z-(-10.8+2+1.2))<1e-8);
  for(const old of ['distribution','fulfillment','highbay'])assert.equal(M.normalize({...c,geometry:undefined,template:old}).geometry,'parallel');
});
test('sectors cover every rack once and keep details at 80 racks or fewer',()=>{
  for(const p of M.presets){const c={...M.fromPreset(p.id),aisles:7,bays:23},seen=new Set();
    for(const s of M.sectors(c)){const racks=M.racks(c,s.id);assert.ok(racks.length<=80);for(const r of racks){assert.ok(!seen.has(r.id));seen.add(r.id);}assert.equal(s.locations,racks.length*c.levels*c.positions);}
    assert.equal(seen.size,M.summary(c).racks);assert.equal(M.sectors(c).reduce((sum,s)=>sum+s.locations,0),M.summary(c).locations);
  }
});
test('all geometries have stable unique shelf addresses',()=>{
  for(const p of M.presets){const c=M.fromPreset(p.id),codes=new Set();
    for(const r of allRacks(c))for(let l=0;l<c.levels;l++)for(let u=0;u<c.positions;u++)codes.add(M.slotCode(c,r,l,u));
    assert.equal(codes.size,M.summary(c).locations);assert.throws(()=>M.slotCode(c,allRacks(c)[0],c.levels,0));
    assert.throws(()=>M.slotCode(c,{aisle:999,side:0,bay:0},0,0));
  }
});
test('every oriented rack stays inside the building and outside marked circulation',()=>{
  for(const p of M.presets)for(const angle of [30,45,60]){
    const c={...M.fromPreset(p.id),angle},stats=M.summary(c),roads=M.paths(c).map(M.pathRect);
    for(const rack of allRacks(c)){for(const point of M.corners(rack)){assert.ok(Math.abs(point.x)<stats.width/2,p.id);assert.ok(Math.abs(point.z)<stats.depth/2,p.id);}for(const road of roads)assert.ok(!M.intersects(rack,road),p.id+' rack crosses a road: '+rack.id);}
  }
});
test('default geometry has no intersecting rack footprints',()=>{
  for(const p of M.presets){const c=M.fromPreset(p.id),racks=allRacks(c);for(let i=0;i<racks.length;i++)for(let j=0;j<i;j++){if(Math.hypot(racks[i].x-racks[j].x,racks[i].z-racks[j].z)>c.bayWidth+c.rackDepth)continue;assert.ok(!M.intersects(racks[i],racks[j]),p.id+' overlap '+racks[i].id+' / '+racks[j].id);}}
});
test('coarse row runs preserve rack totals and leave the V and access gaps open',()=>{
  for(const p of M.presets){const c={...M.fromPreset(p.id),aisles:9,bays:31},roads=M.paths(c).map(M.pathRect);
    assert.equal(M.runs(c).reduce((sum,r)=>sum+r.count,0),M.summary(c).racks);
    for(const run of M.runs(c))for(const road of roads)assert.ok(!M.intersects(run,road),p.id+' coarse run bridges a road');
  }
});
test('V depth changes geometry and Chevron angle rotates physical racks',()=>{
  for(const id of ['flying-v','fishbone']){const c=M.fromPreset(id),first=allRacks({...c,vDepth:30}).map(r=>r.id);assert.notDeepEqual(first,allRacks({...c,vDepth:75}).map(r=>r.id));}
  const c=M.fromPreset('chevron'),a=allRacks({...c,angle:30}),b=allRacks({...c,angle:60});assert.notEqual(a[0].rotation,b[0].rotation);assert.notEqual(M.summary({...c,angle:30}).width,M.summary({...c,angle:60}).width);
  assert.equal(a.length,b.length);
});
test('one-sided racks work for all four layouts',()=>{
  for(const p of M.presets){const c=M.fromPreset(p.id),single={...c,sides:1};assert.ok(allRacks(single).every(r=>r.side===0));assert.ok(M.summary(single).locations>0);}
});
test('wide clearances and one-sided angled racks remain inside their footprint',()=>{
  for(const p of M.presets)for(const sides of [1,2])for(const angle of [30,60]){
    const c={...M.fromPreset(p.id),aisleWidth:6,rackDepth:2,bayWidth:1,sides,angle},s=M.summary(c);
    for(const r of allRacks(c))for(const point of M.corners(r)){assert.ok(Math.abs(point.x)<s.width/2,p.id+' x extent');assert.ok(Math.abs(point.z)<s.depth/2,p.id+' z extent');}
    for(const r of allRacks(c))for(const p of M.paths(c).filter(p=>p.kind==='main'))assert.ok(!M.intersects(r,M.pathRect(p)));
  }
});
test('maximum configurations stay serialized as compact parameters and detailed views remain bounded',()=>{
  for(const p of M.presets){const c={...M.fromPreset(p.id),aisles:64,bays:100,levels:12,positions:6},s=M.summary(c);
    assert.ok(s.overview);assert.throws(()=>M.racks(c),/sector/);assert.ok(M.racks(c,'S01').length<=80);assert.ok(JSON.stringify(M.normalize(c)).length<500);assert.ok(s.locations>0);
  }
  assert.equal(M.summary({...M.fromPreset('parallel'),aisles:64,bays:100,levels:12,positions:6}).locations,921600);
});
test('clipped main paths stay within a sector preview',()=>{
  const c=M.fromPreset('fishbone'),s=M.sectors(c)[0],extent={x:s.x,z:s.z,width:s.width+3,depth:s.depth+5};
  for(const path of M.paths(c,extent))for(const p of path.points){assert.ok(p.x>=extent.x-extent.width/2&&p.x<=extent.x+extent.width/2);assert.ok(p.z>=extent.z-extent.depth/2&&p.z<=extent.z+extent.depth/2);}
});
test('invalid or impossible configurations are rejected before preview and persistence',()=>{
  const c=M.fromPreset('parallel');for(const patch of [{aisles:1e9},{levels:0},{positions:1.5},{bays:NaN},{sides:3},{rackDepth:Infinity},{aisles:'2'},{angle:61},{vDepth:0},{geometry:'unknown'}])assert.throws(()=>M.normalize({...c,...patch}));
  assert.throws(()=>M.racks(c,'S999'));assert.throws(()=>M.normalize(null));assert.throws(()=>M.fromPreset('unknown'));assert.deepEqual(M.normalize(JSON.parse(JSON.stringify(c))),c);
  assert.throws(()=>M.summary({...M.fromPreset('flying-v'),aisles:1,bays:1}),/No caben/);
});
