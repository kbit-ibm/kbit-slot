(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.KbitLayout=api;})(typeof window!=='undefined'?window:this,function(){
  'use strict';
  const limits={aisles:[1,64],bays:[1,100],levels:[1,12],positions:[1,6],sides:[1,2],aisleWidth:[1.5,6],bayWidth:[1,4],rackDepth:[.5,2],levelHeight:[.4,2.5],crossEvery:[5,20],vDepth:[25,80],angle:[30,60]};
  const counts=new Set(['aisles','bays','levels','positions','sides','crossEvery','vDepth','angle']);
  const defaults={aisles:6,bays:12,levels:4,positions:3,sides:2,aisleWidth:3,bayWidth:2.7,rackDepth:1.1,levelHeight:1.1,crossEvery:10,vDepth:60,angle:45};
  const presets=[
    {id:'parallel',name:'Paralelo',tag:'Retícula clásica',description:'Filas rectas y cruces transversales.',...defaults},
    {id:'flying-v',name:'Flying-V',tag:'Acceso en V',description:'Filas rectas, conectadas en diagonal.',...defaults},
    {id:'fishbone',name:'Fishbone',tag:'Espina de pescado',description:'Zonas rectas a ambos lados de la V.',...defaults,aisles:4},
    {id:'chevron',name:'Chevron',tag:'Filas inclinadas',description:'Dos alas y una vía central.',...defaults,aisles:4}
  ];
  const legacy={compact:'parallel',distribution:'parallel',fulfillment:'parallel',highbay:'parallel'};
  const round=n=>Math.round(n*100)/100,pad=n=>String(n).padStart(2,'0');
  let cacheKey='',cache=null;
  function fromPreset(id){const p=presets.find(p=>p.id===id);if(!p)throw new Error('Selecciona una distribución disponible.');return normalize({...p,name:'Mi almacén',template:id,geometry:id});}
  function normalize(value){
    if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('El diseño no tiene un formato válido.');
    const geometry=value.geometry??legacy[value.template]??value.template??'parallel';
    if(!presets.some(p=>p.id===geometry))throw new Error('El tipo de almacén no está disponible.');
    const result={version:2,name:String(value.name??'Mi almacén').trim().slice(0,60)||'Mi almacén',template:geometry,geometry};
    for(const [key,[min,max]] of Object.entries(limits)){
      const n=value[key]??((key==='vDepth'||key==='angle')?defaults[key]:undefined);
      if(typeof n!=='number'||!Number.isFinite(n)||n<min||n>max||(counts.has(key)&&!Number.isInteger(n)))throw new Error('Revisa '+key+': debe estar entre '+min+' y '+max+'.');
      result[key]=round(n);
    }
    return result;
  }
  const pitch=c=>c.aisleWidth+c.sides*c.rackDepth+.5;
  const span=c=>c.bays*c.bayWidth+Math.floor((c.bays-1)/c.crossEvery)*3;
  const bayDistance=(c,b)=>c.bayWidth*(b+.5)+Math.floor(b/c.crossEvery)*3;
  const rackCode=(a,s,b)=>'P'+pad(a+1)+'-'+(s===0?'I':'D')+'-E'+pad(b+1);
  function corners(rect){const cs=Math.cos(rect.rotation||0),sn=Math.sin(rect.rotation||0);return [-1,1].flatMap(i=>[-1,1].map(j=>({x:rect.x+i*rect.w/2*cs+j*rect.d/2*sn,z:rect.z-i*rect.w/2*sn+j*rect.d/2*cs})));}
  function intersects(a,b){
    const ac=corners(a),bc=corners(b);
    for(const r of [a.rotation||0,b.rotation||0])for(const axis of [{x:Math.cos(r),z:-Math.sin(r)},{x:Math.sin(r),z:Math.cos(r)}]){
      const av=ac.map(p=>p.x*axis.x+p.z*axis.z),bv=bc.map(p=>p.x*axis.x+p.z*axis.z);
      if(Math.max(...av)<=Math.min(...bv)+1e-7||Math.max(...bv)<=Math.min(...av)+1e-7)return false;
    }
    return true;
  }
  function pathRect(path){const [a,b]=path.points;return {x:(a.x+b.x)/2,z:(a.z+b.z)/2,w:path.width,d:Math.hypot(b.x-a.x,b.z-a.z),rotation:Math.atan2(b.x-a.x,b.z-a.z)};}
  function boundsOf(items){let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity;for(const r of items)for(const p of corners(r)){minX=Math.min(minX,p.x);maxX=Math.max(maxX,p.x);minZ=Math.min(minZ,p.z);maxZ=Math.max(maxZ,p.z);}return {minX,maxX,minZ,maxZ,x:(minX+maxX)/2,z:(minZ+maxZ)/2,width:maxX-minX,depth:maxZ-minZ};}
  function build(c){
    const all=[],paths=[],step=pitch(c),length=span(c);let width,depth,zShift=-4;
    const add=(a,side,b,x,z,rotation=0,zone='base',localA=a)=>all.push({id:rackCode(a,side,b),aisle:a,side,bay:b,x,z,rotation,w:c.rackDepth,d:c.bayWidth-.08,zone,localA,locations:c.levels*c.positions});
    const road=(id,a,b,kind='main',w=c.aisleWidth)=>paths.push({id,kind,width:w,points:[a,b]});
    if(c.geometry==='chevron'){
      const theta=c.angle*Math.PI/180,cs=Math.cos(theta),sn=Math.sin(theta),offset=c.aisleWidth/2+c.rackDepth/2;
      const start=c.aisleWidth/2+(offset+c.rackDepth/2)*sn+.25;
      for(let wing=0;wing<2;wing++){
        const sign=wing===0?-1:1,rotation=Math.atan2(sign*cs,-sn),nx=Math.cos(rotation),nz=-Math.sin(rotation),tx=Math.sin(rotation),tz=Math.cos(rotation);
        for(let a=0;a<c.aisles;a++)for(let b=0;b<c.bays;b++)for(let side=0;side<c.sides;side++){
          const u=(side===0?-1:1)*offset*sign,v=bayDistance(c,b);
          add(wing*c.aisles+a,side,b,sign*start+nx*u+tx*v,-a*step/cs+nz*u+tz*v,rotation,wing===0?'left':'right',a);
        }
      }
      const bounds=boundsOf(all);width=bounds.width;depth=bounds.depth;zShift=-4-bounds.z;
      road('central',{x:0,z:bounds.maxZ+1},{x:0,z:bounds.minZ-1});
    }else{
      const fish=c.geometry==='fishbone';width=(fish?2:1)*c.aisles*step;depth=fish?Math.max(length,2*c.aisles*step):length;
      const front=depth/2,back=-depth/2,slope=depth*c.vDepth/100/(width/2),clear=(c.aisleWidth/2+.18)*Math.sqrt(1+slope*slope);
      if(c.geometry!=='parallel'){
        road('v-left',{x:0,z:front},{x:-width/2,z:front-depth*c.vDepth/100});
        road('v-right',{x:0,z:front},{x:width/2,z:front-depth*c.vDepth/100});
      }
      const corridors=paths.map(pathRect);
      const verticalCount=fish?2*c.aisles:c.aisles;
      for(let a=0;a<verticalCount;a++)for(let b=0;b<c.bays;b++)for(let side=0;side<c.sides;side++){
        const x=(a-(verticalCount-1)/2)*step+(side===0?-1:1)*(c.aisleWidth/2+c.rackDepth/2),z=back+bayDistance(c,b);
        const rect={x,z,w:c.rackDepth+.08,d:c.bayWidth,rotation:0};
        if(fish&&!corners(rect).every(p=>p.z<front-slope*Math.abs(p.x)-clear))continue;
        if(!fish&&c.geometry==='flying-v'&&corridors.some(path=>intersects(rect,path)))continue;
        add(a,side,b,x,z,0,fish?(a<c.aisles?'upper-left':'upper-right'):'base',fish?a%c.aisles:a);
      }
      if(fish)for(let wing=0;wing<2;wing++)for(let a=0;a<c.aisles;a++)for(let b=0;b<c.bays;b++)for(let side=0;side<c.sides;side++){
        const sign=wing===0?-1:1,x=sign*(width/2-bayDistance(c,b)),z=front-(a+.5)*step+(side===0?-1:1)*(c.aisleWidth/2+c.rackDepth/2);
        const rect={x,z,w:c.rackDepth+.08,d:c.bayWidth,rotation:Math.PI/2};
        if(!corners(rect).every(p=>Math.abs(p.x)<width/2+.001&&p.x*sign>0&&p.z<=front&&p.z>=back&&p.z>front-slope*Math.abs(p.x)+clear))continue;
        add((2+wing)*c.aisles+a,side,b,x,z,Math.PI/2,wing===0?'lower-left':'lower-right',a);
      }
      if(c.geometry==='parallel'||c.geometry==='flying-v')for(let b=c.crossEvery;b<c.bays;b+=c.crossEvery){const z=back+b*c.bayWidth+Math.floor((b-1)/c.crossEvery)*3+1.5;road('cross-'+b,{x:-width/2,z},{x:width/2,z},'cross',3);}
    }
    // Rack geometry stays independent of the number of levels and shelf locations.
    if(!all.length)throw new Error('No caben estantes con estas medidas. Amplía las filas o el tamaño del estante.');
    all.forEach(r=>r.z+=zShift);paths.forEach(path=>path.points.forEach(p=>p.z+=zShift));
    width=round(width+4);depth=round(depth+12);
    if(c.geometry!=='parallel')road('entrada',{x:0,z:depth/2-2.7},{x:0,z:c.geometry==='chevron'?paths[0].points[0].z:depth/2-6});
    const groups=new Map();
    for(const rack of all){const key=rack.zone+':'+Math.floor(rack.localA/4)+':'+Math.floor(rack.bay/10);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(rack);}
    const sectors=[],sectorRacks=new Map(),runs=[];
    for(const group of groups.values()){
      const id='S'+pad(sectors.length+1),bounds=boundsOf(group),aStart=Math.min(...group.map(r=>r.aisle)),aEnd=Math.max(...group.map(r=>r.aisle))+1;
      sectors.push({id,aStart,aEnd,bStart:Math.min(...group.map(r=>r.bay)),bEnd:Math.max(...group.map(r=>r.bay))+1,racks:group.length,locations:group.length*c.levels*c.positions,x:bounds.x,z:bounds.z,width:bounds.width,depth:bounds.depth,zone:group[0].zone});sectorRacks.set(id,group);
      const lines=new Map();for(const rack of group){const key=rack.aisle+':'+rack.side;if(!lines.has(key))lines.set(key,[]);lines.get(key).push(rack);}
      for(const line of lines.values()){
        line.sort((a,b)=>a.bay-b.bay);let part=[];
        const emit=()=>{if(!part.length)return;const first=part[0],last=part.at(-1);runs.push({sectorId:id,x:(first.x+last.x)/2,z:(first.z+last.z)/2,w:c.rackDepth,d:Math.hypot(last.x-first.x,last.z-first.z)+c.bayWidth-.08,rotation:first.rotation,count:part.length});part=[];};
        for(const rack of line){if(part.length&&Math.hypot(rack.x-part.at(-1).x,rack.z-part.at(-1).z)>c.bayWidth+.1)emit();part.push(rack);}emit();
      }
    }
    return {all,paths,sectors,sectorRacks,runs,byId:new Map(all.map(r=>[r.id,r])),stats:{racks:all.length,locations:all.length*c.levels*c.positions,width,depth,area:round(width*depth),height:round(c.levels*c.levelHeight+.2),sectors:sectors.length,overview:all.length>400,aisleCount:new Set(all.map(r=>r.aisle)).size,geometry:c.geometry}};
  }
  function data(value){const c=normalize(value),key=JSON.stringify(c);if(key!==cacheKey){const next=build(c);cache=next;cacheKey=key;}return cache;}
  function summary(c){return {...data(c).stats};}
  function sectors(c){return data(c).sectors;}
  function racks(c,sectorId){const d=data(c);if(sectorId){const found=d.sectorRacks.get(sectorId);if(!found)throw new Error('El sector no existe en este diseño.');return found;}if(d.stats.overview)throw new Error('Selecciona un sector para ver sus estantes.');return d.all;}
  function paths(c,extent){
    const source=data(c).paths;if(!extent)return source;
    return source.flatMap(path=>{const [a,b]=path.points,dx=b.x-a.x,dz=b.z-a.z,half=path.width/2;let lo=0,hi=1;const minX=extent.x-extent.width/2+half,maxX=extent.x+extent.width/2-half,minZ=extent.z-extent.depth/2+half,maxZ=extent.z+extent.depth/2-half;
      for(const [p,q] of [[-dx,a.x-minX],[dx,maxX-a.x],[-dz,a.z-minZ],[dz,maxZ-a.z]]){if(Math.abs(p)<1e-9){if(q<0)return [];continue;}const t=q/p;if(p<0)lo=Math.max(lo,t);else hi=Math.min(hi,t);if(lo>=hi)return [];}
      return [{...path,points:[{x:a.x+lo*dx,z:a.z+lo*dz},{x:a.x+hi*dx,z:a.z+hi*dz}]}];});
  }
  function runs(c,sectorId){return sectorId?data(c).runs.filter(r=>r.sectorId===sectorId):data(c).runs;}
  function slotCode(value,rack,level,position){const c=normalize(value);if(!rack||![rack.aisle,rack.side,rack.bay,level,position].every(Number.isInteger)||level<0||level>=c.levels||position<0||position>=c.positions||!data(c).byId.has(rackCode(rack.aisle,rack.side,rack.bay)))throw new Error('La ubicación está fuera del diseño.');return rackCode(rack.aisle,rack.side,rack.bay)+'-N'+pad(level+1)+'-U'+pad(position+1);}
  return {limits,presets,fromPreset,normalize,summary,sectors,racks,slotCode,paths,runs,corners,intersects,pathRect};
});
