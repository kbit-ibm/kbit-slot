(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.KbitLayout=api;})(typeof window!=='undefined'?window:this,function(){
  'use strict';
  const limits={aisles:[1,64],bays:[1,100],levels:[1,12],positions:[1,6],sides:[1,2],aisleWidth:[1.5,6],bayWidth:[1,4],rackDepth:[.5,2],levelHeight:[.4,2.5],crossEvery:[5,20]};
  const counts=new Set(['aisles','bays','levels','positions','sides','crossEvery']);
  const presets=[
    {id:'compact',name:'Compacto',tag:'Primer almacén',description:'Pocos pasillos, todo a mano.',aisles:2,bays:4,levels:3,positions:2,sides:2,aisleWidth:2.4,bayWidth:2.4,rackDepth:1,levelHeight:.75,crossEvery:10},
    {id:'distribution',name:'Distribución',tag:'Operación diaria',description:'Más frentes y pasillos de acceso.',aisles:6,bays:12,levels:4,positions:3,sides:2,aisleWidth:3,bayWidth:2.7,rackDepth:1.1,levelHeight:1.1,crossEvery:10},
    {id:'fulfillment',name:'Fulfillment',tag:'Gran escala',description:'Una red de sectores para explorar.',aisles:20,bays:30,levels:6,positions:3,sides:2,aisleWidth:3.2,bayWidth:2.7,rackDepth:1.1,levelHeight:1.1,crossEvery:10},
    {id:'highbay',name:'Estantería alta',tag:'Capacidad vertical',description:'Aprovecha la altura de cada estante.',aisles:10,bays:16,levels:8,positions:2,sides:2,aisleWidth:3.5,bayWidth:2.7,rackDepth:1.2,levelHeight:1.25,crossEvery:8}
  ];
  const round=n=>Math.round(n*100)/100;
  const pad=n=>String(n).padStart(2,'0');
  function fromPreset(id){const preset=presets.find(p=>p.id===id);if(!preset)throw new Error('Selecciona una plantilla disponible.');return normalize({...preset,name:'Mi almacén',template:id});}
  function normalize(value){
    if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('El diseño no tiene un formato válido.');
    const result={version:1,name:String(value.name??'Mi almacén').trim().slice(0,60)||'Mi almacén',template:presets.some(p=>p.id===value.template)?value.template:'compact'};
    for(const [key,[min,max]] of Object.entries(limits)){
      const n=value[key];
      if(typeof n!=='number'||!Number.isFinite(n)||n<min||n>max||(counts.has(key)&&!Number.isInteger(n)))throw new Error('Revisa '+key+': debe estar entre '+min+' y '+max+'.');
      result[key]=round(n);
    }
    return result;
  }
  function summary(value){
    const c=normalize(value),racks=c.aisles*c.bays*c.sides;
    const width=round(c.aisles*pitch(c)+4),depth=round(c.bays*c.bayWidth+Math.floor((c.bays-1)/c.crossEvery)*3+12);
    return {racks,locations:racks*c.levels*c.positions,width,depth,area:round(width*depth),height:round(c.levels*c.levelHeight+.2),sectors:Math.ceil(c.aisles/4)*Math.ceil(c.bays/10),overview:racks>400};
  }
  function pitch(c){return c.aisleWidth+c.sides*c.rackDepth+.5;}
  function aisleX(c,a){return (a-(c.aisles-1)/2)*pitch(c);}
  function bayZ(c,b){const depth=c.bays*c.bayWidth+Math.floor((c.bays-1)/c.crossEvery)*3+12;return -depth/2+2+c.bayWidth*(b+.5)+Math.floor(b/c.crossEvery)*3;}
  function rackCode(a,s,b){return 'P'+pad(a+1)+'-'+(s===0?'I':'D')+'-E'+pad(b+1);}
  function sectors(value){
    const c=normalize(value),result=[];
    for(let a=0;a<c.aisles;a+=4)for(let b=0;b<c.bays;b+=10){const aEnd=Math.min(a+4,c.aisles),bEnd=Math.min(b+10,c.bays),racks=(aEnd-a)*(bEnd-b)*c.sides;
      result.push({id:'S'+pad(result.length+1),aStart:a,aEnd,bStart:b,bEnd,racks,locations:racks*c.levels*c.positions,x:(aisleX(c,a)+aisleX(c,aEnd-1))/2,z:(bayZ(c,b)+bayZ(c,bEnd-1))/2,width:(aEnd-a)*pitch(c)-.5,depth:bayZ(c,bEnd-1)-bayZ(c,b)+c.bayWidth});}
    return result;
  }
  function racks(value,sectorId){
    const c=normalize(value),sector=sectorId?sectors(c).find(s=>s.id===sectorId):null;
    if(sectorId&&!sector)throw new Error('El sector no existe en este diseño.');
    // Never materialize a giant building: detailed geometry is limited to one sector.
    if(!sector&&summary(c).overview)throw new Error('Selecciona un sector para ver sus estantes.');
    const result=[];
    for(let a=sector?.aStart??0;a<(sector?.aEnd??c.aisles);a++)for(let b=sector?.bStart??0;b<(sector?.bEnd??c.bays);b++)for(let s=0;s<c.sides;s++)result.push({id:rackCode(a,s,b),aisle:a,side:s,bay:b,x:aisleX(c,a)+(s===0?-1:1)*(c.aisleWidth/2+c.rackDepth/2),z:bayZ(c,b),locations:c.levels*c.positions});
    return result;
  }
  function slotCode(value,rack,level,position){const c=normalize(value);if(!rack||!Number.isInteger(rack.aisle)||!Number.isInteger(rack.side)||!Number.isInteger(rack.bay)||rack.aisle<0||rack.aisle>=c.aisles||rack.side<0||rack.side>=c.sides||rack.bay<0||rack.bay>=c.bays||!Number.isInteger(level)||level<0||level>=c.levels||!Number.isInteger(position)||position<0||position>=c.positions)throw new Error('La ubicación está fuera del diseño.');return rackCode(rack.aisle,rack.side,rack.bay)+'-N'+pad(level+1)+'-U'+pad(position+1);}
  return {limits,presets,fromPreset,normalize,summary,sectors,racks,slotCode};
});
