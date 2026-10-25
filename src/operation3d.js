import * as THREE from 'three';
import {createLayoutScene} from './layout3d.js';

function create(host,options){
  const runtime=options.physical,E=options.engine,css=getComputedStyle(document.documentElement),token=name=>css.getPropertyValue('--'+name).trim(),accent=token('accent'),colors=E.groups.map((_,i)=>token('fam-'+i));
  const overlay=new THREE.Group(),routeGroup=new THREE.Group(),linksGroup=new THREE.Group(),packages=[],geometry=new THREE.BoxGeometry(1,1,1);
  let assignment=[...options.assignment],selected=-1,heat=false,category=-1,connections=false,playing=false,simulation=null,index=0,elapsed=0,speed=1,last=0,route=null;
  const counts=E.products.map(p=>options.orders.filter(o=>o.items.includes(p.id)).length),flows=E.flow(options.orders),maxCount=Math.max(1,...counts);
  const scene=createLayoutScene(host,{inventory:true,onSector:id=>focus(id),onRay:ray=>{const hit=ray.intersectObjects(packages.filter(p=>p.group.visible).map(p=>p.body),false)[0];if(hit){select(hit.object.userData.product);return true;}return false;}});
  function focus(id){scene.focusSector(id);for(const p of packages)p.group.visible=!id||runtime.slots[assignment[p.product.id]].sector===id;options.onFocus?.(id);}
  scene.update(runtime.config);scene.add(overlay);overlay.add(routeGroup,linksGroup);
  function clear(group){group.children.slice().forEach(child=>{child.removeFromParent();child.traverse(o=>{o.geometry?.dispose();if(o.material){o.material.map?.dispose();o.material.dispose();}});});}
  const point=slot=>new THREE.Vector3(runtime.slots[slot].x,runtime.slots[slot].y,runtime.slots[slot].z);
  for(const p of E.products){
    const group=new THREE.Group(),mat=new THREE.MeshStandardMaterial({color:colors[p.family],roughness:.75,transparent:true}),body=new THREE.Mesh(geometry,mat);
    body.scale.set(runtime.config.rackDepth*.74,runtime.config.levelHeight*.5,runtime.config.bayWidth/runtime.config.positions*.68);body.userData.product=p.id;group.add(body);
    const tape=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({color:token('panel')}));tape.scale.set(body.scale.x*.13,body.scale.y+.012,body.scale.z+.012);group.add(tape);
    group.position.copy(point(assignment[p.id]));group.rotation.y=runtime.slots[assignment[p.id]].rotation;overlay.add(group);packages.push({group,body,mat,product:p});
  }
  function styles(){for(const p of packages){const active=p.product.id===selected;p.mat.opacity=category>=0&&p.product.family!==category?.13:1;p.mat.color.set(heat?new THREE.Color(token('heat-0')).lerp(new THREE.Color(token('crit')),counts[p.product.id]/maxCount):colors[p.product.family]);p.mat.emissive.set(active?accent:'#000000');p.mat.emissiveIntensity=active?.5:0;}scene.invalidate();}
  function links(){clear(linksGroup);if(selected<0||!connections)return;const from=packages[selected].group.position;E.products.filter(p=>p.id!==selected&&flows[selected][p.id]).sort((a,b)=>flows[selected][b.id]-flows[selected][a.id]).slice(0,3).forEach(p=>{const to=packages[p.id].group.position,mid=from.clone().lerp(to,.5);mid.y=Math.max(from.y,to.y)+runtime.stats.height;const curve=new THREE.QuadraticBezierCurve3(from.clone(),mid,to.clone());linksGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(32)),new THREE.LineBasicMaterial({color:accent,transparent:true,opacity:.7})));});scene.invalidate();}
  function emit(){if(selected<0){options.onSelect?.(null);return;}const p=E.products[selected];options.onSelect?.({...p,slot:assignment[selected],count:counts[selected],pinned:options.pinned.includes(selected),related:E.products.filter(q=>q.id!==selected&&flows[selected][q.id]).sort((a,b)=>flows[selected][b.id]-flows[selected][a.id]).slice(0,3).map(q=>({name:q.name,count:flows[selected][q.id]}))});}
  function select(id){selected=id;styles();links();emit();if(!playing&&id>=0)focus(runtime.slots[assignment[id]].sector);}
  function resetPositions(){packages.forEach((p,id)=>{p.group.position.copy(point(assignment[id]));p.group.rotation.y=runtime.slots[assignment[id]].rotation;});}
  function prepare(){
    clear(routeGroup);route=null;
    if(index>=simulation.tasks.length){playing=false;emit();links();options.onPlayback?.({status:'complete',step:index,total:simulation.tasks.length,progress:1,plan:simulation});return;}
    const task={...simulation.tasks[index],fromSector:runtime.slots[simulation.tasks[index].from].sector,toSector:runtime.slots[simulation.tasks[index].to].sector},points=runtime.route(task.from,task.to).map(p=>new THREE.Vector3(p.x,p.y,p.z)),lengths=[0];
    for(let i=1;i<points.length;i++)lengths.push(lengths[i-1]+points[i].distanceTo(points[i-1]));route={task,points,lengths,total:lengths.at(-1),duration:Math.max(2,Math.min(5,lengths.at(-1)*.06))};
    const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),new THREE.LineDashedMaterial({color:accent,dashSize:.35,gapSize:.2,depthTest:false}));line.computeLineDistances();line.renderOrder=4;routeGroup.add(line);
    select(task.product);focus(task.fromSector===task.toSector?task.fromSector:null);
    options.onPlayback?.({status:playing?'playing':'paused',step:index,total:simulation.tasks.length,progress:index/simulation.tasks.length,task,plan:simulation});
  }
  function pointAt(fraction){const d=fraction*route.total;for(let i=1;i<route.lengths.length;i++)if(d<=route.lengths[i])return route.points[i-1].clone().lerp(route.points[i],(d-route.lengths[i-1])/(route.lengths[i]-route.lengths[i-1]));return route.points.at(-1);}
  function play(plan){
    if(!simulation||index>=simulation.tasks.length||plan){simulation=plan||options.getPlan();if(!simulation?.tasks.length){options.onPlayback?.({status:'empty',total:0,progress:0});return;}assignment=[...simulation.initial];resetPositions();index=0;elapsed=0;playing=true;prepare();}
    else{playing=!playing;options.onPlayback?.({status:playing?'playing':'paused',step:index,total:simulation.tasks.length,progress:(index+(route?elapsed/route.duration:0))/simulation.tasks.length,task:route?.task,plan:simulation});}last=0;scene.invalidate();
  }
  function stop(){playing=false;simulation=null;index=0;elapsed=0;route=null;assignment=[...options.assignment];resetPositions();clear(routeGroup);select(-1);focus(null);options.onPlayback?.({status:'idle',step:0,total:0,progress:0});scene.invalidate();}
  scene.onFrame(time=>{const dt=last?Math.min((time-last)/1000,.08):0;last=time;if(!playing||!route)return false;elapsed+=dt*speed;const t=Math.min(1,elapsed/route.duration),p=packages[route.task.product];p.group.position.copy(pointAt(t));options.onProgress?.((index+t)/simulation.tasks.length);if(t>=1){assignment[route.task.product]=route.task.to;resetPositions();index++;elapsed=0;prepare();}return playing;});
  styles();
  const nextTask=options.highlight?.length?options.highlight[0]:-1;if(nextTask>=0)select(nextTask);
  return {play,stop,select,focusAll:()=>focus(null),resize:scene.resize,preset:name=>scene.preset(name==='top'?'top':'iso'),zoom:scene.zoom,setSpeed:value=>speed=value,setHeat(value){heat=value;styles();},setCategory(value){category=value;styles();},setConnections(value){connections=value;links();emit();},destroy(){playing=false;overlay.removeFromParent();clear(routeGroup);clear(linksGroup);packages.forEach(p=>{p.mat.dispose();p.group.children.forEach(o=>{if(o.material!==p.mat)o.material?.dispose();});});geometry.dispose();scene.destroy();}};
}
window.KbitOperation3D={create};
