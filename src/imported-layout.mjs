// Coordinates and routes use the same rectangular layout units as the engine.
export function importedLayout(engine) {
  const {aisles,bays,aisleSpacing}=engine.layout.spec;
  const width=(aisles.length-1)*aisleSpacing+4,depth=bays+3;
  const point=(slot,y=.8)=>{
    const s=engine.layout.slots[slot];
    return {x:(s.aisle-(aisles.length-1)/2)*aisleSpacing,y,z:s.bay-(bays-1)/2};
  };
  const route=(from,to)=>{
    const a=point(from),b=point(to);
    if(a.x===b.x)return [a,b];
    const front=-(bays+1)/2,back=(bays+1)/2;
    const crossing=Math.abs(a.z-front)+Math.abs(b.z-front)<=Math.abs(a.z-back)+Math.abs(b.z-back)?front:back;
    return [a,{...a,z:crossing},{...b,z:crossing},b];
  };
  return {width,depth,point,route};
}
