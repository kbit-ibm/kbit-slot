(function(root,factory){const api=typeof module==='object'&&module.exports?factory(require('./layout-model.js'),require('./engine.js')):factory(root.KbitLayout,root.KbitEngine);if(typeof module==='object'&&module.exports)module.exports=api;else root.KbitOperation=api;})(typeof window!=='undefined'?window:this,function(M,Base){
  'use strict';
  const distance=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
  const pad=n=>String(n).padStart(2,'0');
  // Complete mode: every location of a design, up to COMPLETE_LIMIT, with a generated catalogue at its scale
  // (about 30 % of the locations, at most 150 SKUs, a multiple of the six families, cleaning fitting on the ground of its
  // aisle: the last one in a Parallel design, the one with most ground locations in the diagonal geometries).
  const COMPLETE_LIMIT=3000,MAX_PRODUCTS=150;
  function completeProducts(config){
    const racks=M.sectors(config).flatMap(s=>M.racks(config,s.id)),ground=new Map();
    for(const r of racks)ground.set(r.aisle,(ground.get(r.aisle)||0)+config.positions);
    const cleaning=config.geometry==='parallel'?ground.get(Math.max(...ground.keys())):Math.max(...ground.values());
    const n=Math.min(MAX_PRODUCTS,Math.floor(racks.length*config.levels*config.positions*.3),racks.length*config.positions,6*cleaning);return n-n%6;
  }
  function supportsComplete(value){
    const c=M.normalize(value),s=M.summary(c);
    if(s.locations>COMPLETE_LIMIT)return {ok:false,reason:'El modo completo admite hasta '+COMPLETE_LIMIT.toLocaleString('es-PE')+' ubicaciones; este diseño tiene '+s.locations.toLocaleString('es-PE')+'.'};
    const products=completeProducts(c);
    return products<12?{ok:false,reason:'El diseño es demasiado pequeño para el modo completo.'}:{ok:true,locations:s.locations,products};
  }
  function catalog(count){const per=count/Base.groups.length;return Array.from({length:count},(_,id)=>{const family=Math.floor(id/per);return {id,code:'SKU-'+String(id+1).padStart(4,'0'),name:Base.groups[family]+' '+pad(id%per+1),family,category:Base.groups[family]};});}
  function fingerprint(value){const c=M.normalize(value);delete c.name;let h=2166136261;for(const ch of JSON.stringify(c))h=Math.imul(h^ch.charCodeAt(0),16777619);return 'physical-v1-'+(h>>>0).toString(16);}
  function create(value,{mode='muestra'}={}){
    const config=M.normalize(value),stats=M.summary(config),sectors=M.sectors(config),complete=mode==='completa';
    if(complete){const check=supportsComplete(config);if(!check.ok)throw new Error(check.reason);}
    if(stats.locations<2)throw new Error('Para reubicar productos necesitas al menos dos ubicaciones, una libre.');
    const selected=[],seen=new Set(),ordered=[];
    for(let i=0;i<Math.min(8,sectors.length);i++)ordered.push(sectors[Math.floor(i*sectors.length/Math.min(8,sectors.length))]);
    for(const s of sectors)if(!ordered.includes(s))ordered.push(s);
    const budget=complete?stats.locations:Math.min(64,stats.locations);
    // Spreads limit(total) locations over a sector's racks, skipping those already in the sample, until it holds `until`.
    function pick(sector,limit,until){
      const racks=M.racks(config,sector.id),total=racks.length*config.levels*config.positions,take=limit(total);
      for(let i=0;i<take&&selected.length<until;i++){const flat=Math.floor(i*total/take),r=racks[Math.floor(flat/(config.levels*config.positions))],l=Math.floor(flat/config.positions)%config.levels,p=flat%config.positions,name=M.slotCode(config,r,l,p);if(seen.has(name))continue;seen.add(name);selected.push({name,rack:r,sector:sector.id,level:l,position:p});}
    }
    for(const sector of ordered){pick(sector,total=>complete?total:Math.min(8,total,budget-selected.length),budget);if(selected.length===budget)break;}
    // With fewer than 4 sectors, 8 locations each leave room for fewer than the 30 example products: fill the sample up to
    // 30 products, a reserve and a free location with the remaining ones, sector by sector.
    const spread=selected.length,enough=Math.min(budget,Base.products.length+2);
    for(const sector of ordered){if(selected.length>=enough)break;pick(sector,total=>total,enough);}
    const off=config.aisleWidth/2+config.rackDepth/2;
    function access(r){
      if(config.geometry==='chevron'){const sign=r.zone==='left'?-1:1,u=(r.side===0?-1:1)*off*sign;return {x:r.x-Math.cos(r.rotation)*u,z:r.z+Math.sin(r.rotation)*u};}
      if(r.zone.startsWith('lower'))return {x:r.x,z:r.z-(r.side===0?-1:1)*off};
      return {x:r.x-(r.side===0?-1:1)*off,z:r.z};
    }
    function position(item){
      const r=item.rack,dz=((item.position+.5)/config.positions-.5)*(config.bayWidth-.15);
      const p={x:r.x+Math.sin(r.rotation)*dz,y:.16+item.level*config.levelHeight+config.levelHeight*.26,z:r.z+Math.cos(r.rotation)*dz};
      const a=access(r);a.x+=Math.sin(r.rotation)*dz;a.z+=Math.cos(r.rotation)*dz;
      return {...item,...p,access:a,rotation:r.rotation,aisleName:'P'+pad(r.aisle+1)};
    }
    const slots=selected.map(position),allRows=new Map();
    for(const s of sectors)for(const rack of M.racks(config,s.id)){if(!allRows.has(rack.aisle))allRows.set(rack.aisle,[]);allRows.get(rack.aisle).push(rack);}
    const main=M.paths(config).filter(p=>p.kind==='main'||p.kind==='cross'),diagonals=main.filter(p=>p.id==='v-left'||p.id==='v-right');
    let front=-Infinity,back=Infinity;
    for(const row of allRows.values())for(const rack of row)for(const p of M.corners(rack)){front=Math.max(front,p.z);back=Math.min(back,p.z);}
    for(const path of diagonals)for(const p of path.points)front=Math.max(front,p.z);
    const lines=[],half=(stats.width-4)/2;
    const line=(a,b)=>{if(distance(a,b)>.0001)lines.push({a,b,points:[]});};
    // Use the rendered V directly: rebuilding it from dimensions loses its coordinate shift.
    function vJunction(a,horizontal){
      const [u,v]=diagonals.find(p=>p.id===(a.x<0?'v-left':'v-right')).points;
      const t=horizontal?(a.z-u.z)/(v.z-u.z):(a.x-u.x)/(v.x-u.x);
      return {x:u.x+t*(v.x-u.x),z:u.z+t*(v.z-u.z)};
    }
    main.forEach(p=>line(p.points[0],p.points[1]));
    if(config.geometry!=='chevron'){
      line({x:-half-1,z:front+1},{x:half+1,z:front+1});line({x:-half-1,z:back-1},{x:half+1,z:back-1});
      line({x:-half-1,z:back-1},{x:-half-1,z:front+1});line({x:half+1,z:back-1},{x:half+1,z:front+1});
    }
    const rowLines=new Map(),junctions=[];
    for(const [id,row] of allRows){
      const r=row[0],a=access(r);let start,end;
      if(config.geometry==='chevron'){
        const tx=Math.sin(r.rotation),tz=Math.cos(r.rotation),joint={x:0,z:a.z-a.x*tz/tx};
        const far=row.map(access).sort((u,v)=>(v.x*tx+v.z*tz)-(u.x*tx+u.z*tz))[0];
        start=joint;end={x:far.x+tx*(config.bayWidth/2+.5),z:far.z+tz*(config.bayWidth/2+.5)};junctions.push(joint.z);
      }else if(r.zone.startsWith('lower')){
        const sign=r.zone==='lower-left'?-1:1;
        start={x:sign*(half+1),z:a.z};end=vJunction(a,true);
      }else{
        start={x:a.x,z:back-1};end=config.geometry==='fishbone'?vJunction(a,false):{x:a.x,z:front+1};
      }
      line(start,end);rowLines.set(id,lines.at(-1));
    }
    if(junctions.length)line({x:0,z:Math.min(...junctions)-1},{x:0,z:Math.max(...junctions)+1});
    const nodes=[],nodeByKey=new Map(),edges=[];
    function node(p){const key=Math.round(p.x*1e6)+':'+Math.round(p.z*1e6);if(!nodeByKey.has(key)){nodeByKey.set(key,nodes.length);nodes.push({x:p.x,z:p.z});edges.push([]);}return nodeByKey.get(key);}
    function addPoint(l,p){l.points.push(node(p));}
    for(const l of lines){addPoint(l,l.a);addPoint(l,l.b);}
    for(let i=0;i<lines.length;i++)for(let j=0;j<i;j++){
      const u=lines[i],v=lines[j],dx=u.b.x-u.a.x,dz=u.b.z-u.a.z,ex=v.b.x-v.a.x,ez=v.b.z-v.a.z,den=dx*ez-dz*ex;
      if(Math.abs(den)<1e-8)continue;
      const ax=v.a.x-u.a.x,az=v.a.z-u.a.z,t=(ax*ez-az*ex)/den,s=(ax*dz-az*dx)/den;
      if(t>=-1e-7&&t<=1+1e-7&&s>=-1e-7&&s<=1+1e-7){const p={x:u.a.x+t*dx,z:u.a.z+t*dz};addPoint(u,p);addPoint(v,p);}
    }
    // Collinear overlaps (a central spine and a front connector) share all on-segment endpoints.
    const onLine=(p,l)=>Math.abs((p.x-l.a.x)*(l.b.z-l.a.z)-(p.z-l.a.z)*(l.b.x-l.a.x))<1e-5&&p.x>=Math.min(l.a.x,l.b.x)-1e-6&&p.x<=Math.max(l.a.x,l.b.x)+1e-6&&p.z>=Math.min(l.a.z,l.b.z)-1e-6&&p.z<=Math.max(l.a.z,l.b.z)+1e-6;
    for(const l of lines)for(const p of [l.a,l.b])for(const other of lines)if(other!==l&&onLine(p,other))addPoint(other,p);
    for(const slot of slots){const l=rowLines.get(slot.rack.aisle);slot.node=node(slot.access);l.points.push(slot.node);}
    for(const l of lines){
      const dx=l.b.x-l.a.x,dz=l.b.z-l.a.z,indices=[...new Set(l.points)].sort((a,b)=>(nodes[a].x-nodes[b].x)*dx+(nodes[a].z-nodes[b].z)*dz);
      for(let i=1;i<indices.length;i++){const a=indices[i-1],b=indices[i],w=distance(nodes[a],nodes[b]);if(w>1e-7){edges[a].push({to:b,w});edges[b].push({to:a,w});}}
    }
    function shortest(from){
      const dist=Array(nodes.length).fill(Infinity),prev=Array(nodes.length).fill(-1),used=new Uint8Array(nodes.length);dist[from]=0;
      // The graph is aisle intersections, not all shelf locations (normally hundreds of nodes).
      for(let count=0;count<nodes.length;count++){let v=-1;for(let i=0;i<nodes.length;i++)if(!used[i]&&(v<0||dist[i]<dist[v]))v=i;if(v<0||!Number.isFinite(dist[v]))break;used[v]=1;for(const edge of edges[v])if(dist[v]+edge.w<dist[edge.to]){dist[edge.to]=dist[v]+edge.w;prev[edge.to]=v;}}
      return {dist,prev};
    }
    // Shortest paths are computed on demand: the sample needs them all for its matrix, the complete mode only for routes.
    const searches=new Map(),search=node=>{if(!searches.has(node))searches.set(node,shortest(node));return searches.get(node);};
    const distances=complete?null:slots.map((a,i)=>slots.map((b,j)=>{if(i===j)return 0;const d=search(a.node).dist[b.node];if(!Number.isFinite(d))throw new Error('No se pudo conectar la circulación de este diseño.');return d+distance(a,a.access)+distance(b,b.access)+Math.abs(a.y-b.y);}));
    const count=complete?completeProducts(config):Math.min(Base.products.length,slots.length-1),products=complete?catalog(count):Base.products.slice(0,count),reserved=slots.at(-1).name;
    // Complete mode: the same metric in closed form. In a Parallel design the graph distance between two locations is the
    // corridor offset plus the best horizontal line (back, cross aisles, front), plus both shelf accesses and the height.
    function corridors(){
      const aisleIds=[...new Set(slots.map(s=>s.rack.aisle))].sort((a,b)=>a-b);
      return {kind:'corridors',name:config.name,aisles:aisleIds.map(a=>'P'+pad(a+1)),corridors:aisleIds.map(a=>slots.find(s=>s.rack.aisle===a).access.x),
        crossings:[...new Set(lines.filter(l=>Math.abs(l.a.z-l.b.z)<1e-9).map(l=>l.a.z))],levelCost:config.levelHeight,accessCost:2*off,
        slots:slots.map(s=>({name:s.name,aisle:aisleIds.indexOf(s.rack.aisle),z:s.access.z,level:s.level})),reserved:[reserved]};
    }
    // Other geometries (V, Fishbone, Chevron) have diagonal circulation: the engine gets the graph itself and runs the same
    // shortest paths for every location, with the entrance as packing.
    function network(){
      const aisleIds=[...new Set(slots.map(s=>s.rack.aisle))].sort((a,b)=>a-b),pairs=[],entrance=M.paths(config).find(p=>p.id==='entrada')?.points[0];
      edges.forEach((list,a)=>{for(const e of list)if(a<e.to)pairs.push([a,e.to,e.w]);});
      return {kind:'network',name:config.name,aisles:aisleIds.map(a=>'P'+pad(a+1)),nodes:nodes.length,edges:pairs,levelCost:config.levelHeight,
        slots:slots.map(s=>({name:s.name,aisle:aisleIds.indexOf(s.rack.aisle),level:s.level,node:s.node,offset:distance(s,s.access)})),reserved:[reserved],
        ...(entrance&&nodeByKey.has(Math.round(entrance.x*1e6)+':'+Math.round(entrance.z*1e6))?{depot:nodeByKey.get(Math.round(entrance.x*1e6)+':'+Math.round(entrance.z*1e6))}:{})};
    }
    const engine=Base.createInstance({layout:complete?(config.geometry==='parallel'?corridors():network()):{kind:'physical',slots:slots.map(({rack,access,node,...s})=>s),distances,reserved:[reserved]},products,groups:Base.groups});
    const key=fingerprint(config)+(complete?'-completa':selected.length>spread?'-muestra'+selected.length:'');
    function route(from,to){
      const a=slots[from],b=slots[to],path=[],found=search(a.node);let v=b.node;while(v!==-1){path.push(nodes[v]);if(v===a.node)break;v=found.prev[v];}path.reverse();
      return [{x:a.x,y:a.y,z:a.z},{...a.access,y:a.y},...path.map(p=>({...p,y:.6})),{...b.access,y:b.y},{x:b.x,y:b.y,z:b.z}].filter((p,i,all)=>!i||Math.hypot(p.x-all[i-1].x,p.y-all[i-1].y,p.z-all[i-1].z)>.0001);
    }
    function demo(){
      if(complete)return engine.demo();
      const ids=engine.layout.assignable.slice();let seed=814;for(let i=ids.length-1;i>0;i--){seed=(Math.imul(seed,1664525)+1013904223)>>>0;const j=seed%(i+1);[ids[i],ids[j]]=[ids[j],ids[i]];}
      return {assignment:ids.slice(0,count),orders:Base.demo().orders.map(o=>({...o,items:o.items.filter(id=>id<count)})).filter(o=>o.items.length)};
    }
    function decorate(plan){return {...plan,layoutKey:key,tasks:plan.tasks.map(t=>({...t,fromSector:slots[t.from].sector,toSector:slots[t.to].sector}))};}
    function blocks(tasks){const result=[];for(const task of tasks){const key=slots[task.from].sector;let block=result.at(-1);if(!block||block.sector!==key){block={sector:key,tasks:[]};result.push(block);}block.tasks.push(task);}return result;}
    return {config,stats,sectors,slots,engine,key,mode:complete?'completa':'muestra',route,demo,decorate,blocks,graph:{nodes,edges,lines:lines.map(l=>({a:l.a,b:l.b}))}};
  }
  return {create,fingerprint,supportsComplete,COMPLETE_LIMIT};
});
