(function(root,factory){const api=typeof module==='object'&&module.exports?factory(require('./layout-model.js'),require('./engine.js')):factory(root.KbitLayout,root.KbitEngine);if(typeof module==='object'&&module.exports)module.exports=api;else root.KbitOperation=api;})(typeof window!=='undefined'?window:this,function(M,Base){
  'use strict';
  const distance=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
  const pad=n=>String(n).padStart(2,'0');
  function fingerprint(value){const c=M.normalize(value);delete c.name;let h=2166136261;for(const ch of JSON.stringify(c))h=Math.imul(h^ch.charCodeAt(0),16777619);return 'physical-v1-'+(h>>>0).toString(16);}
  function create(value){
    const config=M.normalize(value),stats=M.summary(config),sectors=M.sectors(config);
    if(stats.locations<2)throw new Error('Para reubicar productos necesitas al menos dos ubicaciones, una libre.');
    const selected=[],seen=new Set(),ordered=[];
    for(let i=0;i<Math.min(8,sectors.length);i++)ordered.push(sectors[Math.floor(i*sectors.length/Math.min(8,sectors.length))]);
    for(const s of sectors)if(!ordered.includes(s))ordered.push(s);
    const budget=Math.min(64,stats.locations);
    for(const sector of ordered){
      const racks=M.racks(config,sector.id),total=racks.length*config.levels*config.positions,take=Math.min(8,total,budget-selected.length);
      for(let i=0;i<take;i++){const flat=Math.floor(i*total/take),r=racks[Math.floor(flat/(config.levels*config.positions))],l=Math.floor(flat/config.positions)%config.levels,p=flat%config.positions,name=M.slotCode(config,r,l,p);if(seen.has(name))continue;seen.add(name);selected.push({name,rack:r,sector:sector.id,level:l,position:p});}
      if(selected.length===budget)break;
    }
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
    const lines=[],front=stats.depth/2-6,back=-stats.depth/2+2,half=(stats.width-4)/2;
    const line=(a,b)=>{if(distance(a,b)>.0001)lines.push({a,b,points:[]});};
    const main=M.paths(config).filter(p=>p.kind==='main'||p.kind==='cross');
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
        const sign=r.zone==='lower-left'?-1:1,slope=(stats.depth-12)*config.vDepth/100/half;
        start={x:sign*(half+1),z:a.z};end={x:sign*(front-a.z)/slope,z:a.z};
      }else{
        start={x:a.x,z:back-1};end={x:a.x,z:config.geometry==='fishbone'?front-(stats.depth-12)*config.vDepth/100/half*Math.abs(a.x):front+1};
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
    const searches=new Map();for(const slot of slots)if(!searches.has(slot.node))searches.set(slot.node,shortest(slot.node));
    const distances=slots.map((a,i)=>slots.map((b,j)=>{if(i===j)return 0;const d=searches.get(a.node).dist[b.node];if(!Number.isFinite(d))throw new Error('No se pudo conectar la circulación de este diseño.');return d+distance(a,a.access)+distance(b,b.access)+Math.abs(a.y-b.y);}));
    const count=Math.min(Base.products.length,slots.length-1),products=Base.products.slice(0,count),reserved=slots.at(-1).name;
    const engine=Base.createInstance({layout:{kind:'physical',slots:slots.map(({rack,access,node,...s})=>s),distances,reserved:[reserved]},products,groups:Base.groups});
    function route(from,to){
      const a=slots[from],b=slots[to],path=[],search=searches.get(a.node);let v=b.node;while(v!==-1){path.push(nodes[v]);if(v===a.node)break;v=search.prev[v];}path.reverse();
      return [{x:a.x,y:a.y,z:a.z},{...a.access,y:a.y},...path.map(p=>({...p,y:.6})),{...b.access,y:b.y},{x:b.x,y:b.y,z:b.z}].filter((p,i,all)=>!i||Math.hypot(p.x-all[i-1].x,p.y-all[i-1].y,p.z-all[i-1].z)>.0001);
    }
    function demo(){
      const ids=engine.layout.assignable.slice();let seed=814;for(let i=ids.length-1;i>0;i--){seed=(Math.imul(seed,1664525)+1013904223)>>>0;const j=seed%(i+1);[ids[i],ids[j]]=[ids[j],ids[i]];}
      return {assignment:ids.slice(0,count),orders:Base.demo().orders.map(o=>({...o,items:o.items.filter(id=>id<count)})).filter(o=>o.items.length)};
    }
    function decorate(plan){return {...plan,layoutKey:fingerprint(config),tasks:plan.tasks.map(t=>({...t,fromSector:slots[t.from].sector,toSector:slots[t.to].sector}))};}
    function blocks(tasks){const result=[];for(const task of tasks){const key=slots[task.from].sector;let block=result.at(-1);if(!block||block.sector!==key){block={sector:key,tasks:[]};result.push(block);}block.tasks.push(task);}return result;}
    return {config,stats,sectors,slots,engine,key:fingerprint(config),route,demo,decorate,blocks,graph:{nodes,edges,lines:lines.map(l=>({a:l.a,b:l.b}))}};
  }
  return {create,fingerprint};
});
