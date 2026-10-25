const {test}=require('node:test');
const assert=require('node:assert/strict');
const M=require('../dist/layout-model.js');

test('presets express capacity as racks × levels × positions',()=>{
  for(const preset of M.presets){const c=M.fromPreset(preset.id),s=M.summary(c);assert.equal(s.racks,c.aisles*c.bays*c.sides);assert.equal(s.locations,s.racks*c.levels*c.positions);assert.ok(s.area>0);}
  assert.equal(M.summary(M.fromPreset('compact')).locations,96);
  assert.equal(M.summary(M.fromPreset('fulfillment')).locations,21600);
});
test('sectors cover every rack once, including partial edges',()=>{
  const c={...M.fromPreset('distribution'),aisles:7,bays:23};const seen=new Set();
  for(const sector of M.sectors(c))for(const rack of M.racks(c,sector.id)){assert.ok(!seen.has(rack.id));seen.add(rack.id);}
  assert.equal(seen.size,M.summary(c).racks);
  assert.equal(M.sectors(c).reduce((sum,s)=>sum+s.locations,0),M.summary(c).locations);
});
test('locations have stable unique addresses through levels and sides',()=>{
  const c=M.fromPreset('compact'),codes=new Set();for(const rack of M.racks(c))for(let l=0;l<c.levels;l++)for(let p=0;p<c.positions;p++)codes.add(M.slotCode(c,rack,l,p));
  assert.equal(codes.size,M.summary(c).locations);
  assert.ok(codes.has('P01-I-E01-N01-U01'));assert.ok(codes.has('P02-D-E04-N03-U02'));
  assert.throws(()=>M.slotCode(c,M.racks(c)[0],c.levels,0));
});
test('one-sided aisles halve capacity and change building width',()=>{
  const c=M.fromPreset('compact'),single={...c,sides:1};assert.equal(M.summary(single).locations,M.summary(c).locations/2);assert.ok(M.summary(single).width<M.summary(c).width);assert.ok(M.racks(single).every(r=>r.side===0));
});
test('physical extents contain every rack and reflect cross aisles',()=>{
  const c=M.fromPreset('distribution'),s=M.summary(c);for(const rack of M.racks(c)){assert.ok(Math.abs(rack.x)+c.rackDepth/2<s.width/2);assert.ok(Math.abs(rack.z)+c.bayWidth/2<s.depth/2);}
  const row=M.racks(c).filter(r=>r.aisle===0&&r.side===0);assert.equal(Math.round((row[10].z-row[9].z)*10)/10,c.bayWidth+3);
});
test('maximum design stays compact and refuses unbounded detailed geometry',()=>{
  const c={...M.fromPreset('fulfillment'),aisles:64,bays:100,levels:12,positions:6},s=M.summary(c);
  assert.equal(s.locations,921600);assert.equal(M.sectors(c).length,160);assert.throws(()=>M.racks(c),/sector/);
  assert.ok(M.racks(c,'S01').length<=80);assert.ok(JSON.stringify(M.normalize(c)).length<400);
});
test('invalid values are rejected before geometry or persistence',()=>{
  const c=M.fromPreset('compact');for(const patch of [{aisles:1e9},{levels:0},{positions:1.5},{bays:NaN},{sides:3},{rackDepth:Infinity},{aisles:'2'}])assert.throws(()=>M.normalize({...c,...patch}));
  assert.throws(()=>M.racks(c,'S999'));assert.throws(()=>M.normalize(null));assert.throws(()=>M.fromPreset('unknown'));
  assert.deepEqual(M.normalize(JSON.parse(JSON.stringify(c))),c);
});
