import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import './layout3d.js';
import './operation3d.js';
import { createImported } from './imported3d.js';

// Scene colors come from the page's CSS tokens, so the 3D view follows the light or dark theme.
function palette(){const css=getComputedStyle(document.documentElement),token=(name,fallback)=>css.getPropertyValue('--'+name).trim()||fallback;
  return{paper:token('paper','#f2eee4'),panel:token('panel','#fbf8f1'),ink:token('ink','#1f2328'),muted:token('muted','#686357'),rule:token('rule','#d3c9b6'),accent:token('accent','#dc4f1a'),warn:token('warn','#a87604'),crit:token('crit','#b3281d'),heat:token('heat-0','#ecdcae'),families:[0,1,2,3,4,5].map(i=>token('fam-'+i,'#686357'))};}
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const ease=t=>t<.5?2*t*t:1-Math.pow(-2*t+2,2)/2;

function create(host,options){
  const E=window.KbitEngine,scene=new THREE.Scene(),C=palette(),COLORS=C.families,heatStops=[C.heat,C.warn,C.crit].map(color=>new THREE.Color(color));
  const cleaningPad='#'+new THREE.Color(C.panel).lerp(new THREE.Color(COLORS[2]),.22).getHexString();
  let disposed=false,selected=-1,hover=-1,heat=false,connections=false,category=-1,raf,lastTime=0;
  let baseZoom=1,cameraTween=null,simulation=null,playing=false,taskIndex=0,elapsed=0,speed=1,route=null,routeDots=[],linkDots=[];
  const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  const materials=new Map(),labelTextures=[],geometry=new THREE.BoxGeometry(1,1,1),raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2();
  const groups={floor:new THREE.Group(),racks:new THREE.Group(),products:new THREE.Group(),links:new THREE.Group(),route:new THREE.Group()};
  Object.values(groups).forEach(group=>scene.add(group));
  let assignment=[...options.assignment];
  const counts=E.products.map(p=>options.orders.filter(order=>order.items.includes(p.id)).length);
  const maxCount=Math.max(1,...counts),flows=E.flow(options.orders);
  const renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,powerPreference:'high-performance'});
  renderer.setPixelRatio(Math.min(devicePixelRatio,1.7));renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  renderer.toneMapping=THREE.NeutralToneMapping;renderer.toneMappingExposure=1;renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.domElement.setAttribute('aria-label','Almacén 3D interactivo. Arrastra para girar y usa la rueda para acercar. También puedes seleccionar un producto con el buscador.');
  renderer.domElement.setAttribute('role','img');host.append(renderer.domElement);
  const camera=new THREE.OrthographicCamera(-25,25,25,-25,.1,180);camera.position.set(29,29,34);
  const controls=new OrbitControls(camera,renderer.domElement);controls.target.set(0,.4,0);controls.enableDamping=true;controls.dampingFactor=.07;controls.minPolarAngle=.08;controls.maxPolarAngle=Math.PI/2.2;controls.minZoom=.55;controls.maxZoom=3.4;controls.enablePan=true;controls.panSpeed=.65;controls.rotateSpeed=.6;controls.zoomSpeed=.75;
  controls.addEventListener('start',()=>cameraTween=null);
  const hemi=new THREE.HemisphereLight(0xffffff,0xb3a68f,2.1);scene.add(hemi);
  const sunlight=new THREE.DirectionalLight(0xfff9e9,3.3);sunlight.position.set(-13,30,14);sunlight.castShadow=true;sunlight.shadow.mapSize.set(1024,1024);sunlight.shadow.camera.left=-21;sunlight.shadow.camera.right=21;sunlight.shadow.camera.top=23;sunlight.shadow.camera.bottom=-23;sunlight.shadow.normalBias=.08;sunlight.shadow.bias=-.0003;scene.add(sunlight);
  function material(color,roughness=.75){const key=color+roughness;if(!materials.has(key))materials.set(key,new THREE.MeshStandardMaterial({color,roughness,metalness:roughness<.5?.3:0}));return materials.get(key);}
  function box(parent,x,y,z,w,h,d,color,cast=false){const mesh=new THREE.Mesh(geometry,material(color));mesh.position.set(x,y,z);mesh.scale.set(w,h,d);mesh.castShadow=cast;mesh.receiveShadow=true;parent.add(mesh);return mesh;}
  function textTexture(text,{color=C.ink,background='',size=48,width=512,height=128}={}){
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const context=canvas.getContext('2d');
    const draw=()=>{context.clearRect(0,0,width,height);if(background){context.fillStyle=background;context.fillRect(0,0,width,height);}context.fillStyle=color;context.font=`700 ${size}px 'Barlow Condensed', 'Arial Narrow', sans-serif`;context.textAlign='center';context.textBaseline='middle';context.fillText(text,width/2,height/2,width-14);};
    draw();const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;labelTextures.push({draw,texture});return texture;
  }
  function label(parent,text,x,y,z,width=3,height=.7,color=C.ink,background=''){
    const map=textTexture(text,{color,background});const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map,depthWrite:false,transparent:true}));sprite.position.set(x,y,z);sprite.scale.set(width,height,1);parent.add(sprite);return sprite;
  }
  function groundText(text,x,z,width=5,color=C.muted){
    const map=textTexture(text,{color});const plane=new THREE.Mesh(new THREE.PlaneGeometry(width,width/4),new THREE.MeshBasicMaterial({map,transparent:true,depthWrite:false}));plane.rotation.x=-Math.PI/2;plane.position.set(x,.07,z);groups.floor.add(plane);return plane;
  }
  function position(slot,y=1.26){return new THREE.Vector3(-8.4+Math.floor(slot/8)*5.6,y,-10.5+(slot%8)*3);}
  box(groups.floor,0,-.44,0,27,.78,30,C.rule);box(groups.floor,0,-.02,0,26.8,.12,29.8,C.paper);
  const grid=new THREE.GridHelper(27,27,C.muted,C.rule);grid.position.y=.055;grid.material.transparent=true;grid.material.opacity=.45;groups.floor.add(grid);
  for(let aisle=0;aisle<4;aisle++){
    const x=-8.4+aisle*5.6;
    box(groups.floor,x+2.5,.06,0,1.1,.02,23,C.panel);
    for(let z=-10.5;z<=10.5;z+=3)box(groups.floor,x+2.5,.08,z,.12,.02,.5,C.muted);
    box(groups.racks,x,.39,0,3.3,.2,23.8,C.rule);
    for(const side of [-1,1]){
      box(groups.racks,x+side*1.59,.62,0,.12,.17,24,C.ink,true);
      box(groups.racks,x+side*1.59,2.86,0,.09,.11,24,C.ink,true);
      for(let bay=0;bay<9;bay++)box(groups.racks,x+side*1.59,1.54,-12+bay*3,.11,3.02,.11,C.ink,true);
    }
    for(let bay=0;bay<8;bay++){
      const z=-10.5+bay*3;
      box(groups.racks,x,.59,z,3.18,.11,.06,C.muted);
      const pad=box(groups.floor,x,.10,z,2.75,.06,2.5,aisle===3?cleaningPad:C.panel);pad.userData.slot=aisle*8+bay;
      const sign=label(groups.racks,E.slotName(aisle*8+bay),x,.82,z+1.19,1,.28,C.paper,C.ink);sign.userData.slot=aisle*8+bay;
    }
    label(groups.racks,'PASILLO '+'ABCD'[aisle],x,3.1,-13,3.4,.62,C.ink);
    groundText('ABCD'[aisle],x,13,2,C.muted);
  }
  for(let i=0;i<11;i++)box(groups.floor,-12.4+i*1.1,.085,12.3,.48,.02,1,C.ink);
  box(groups.floor,-11.2,.11,12.25,3.5,.025,1.55,C.accent);groundText('EMPAQUE',-8.5,13.3,4,C.ink);
  box(groups.floor,-12.15,.7,9.5,2,.18,2.1,C.muted,true);for(const x of [-12.85,-11.45])for(const z of [8.85,10.15])box(groups.floor,x,.36,z,.12,.65,.12,C.ink);
  for(let i=0;i<3;i++)box(groups.floor,-12.4+i*.7,1.12,9.5,.58,.65,.7,'#c9b08b',true);
  // A small parked picking cart provides scale; it is illustrative, not a robot integration.
  const cart=new THREE.Group();cart.position.set(12.2,0,9.7);groups.floor.add(cart);box(cart,0,.5,0,1,.15,1.6,C.muted,true);box(cart,0,1.15,-.65,1,.1,.1,C.ink);for(const x of [-.45,.45])for(const z of [-.55,.55]){const wheel=new THREE.Mesh(new THREE.CylinderGeometry(.19,.19,.12,12),material(C.ink));wheel.rotation.z=Math.PI/2;wheel.position.set(x,.2,z);cart.add(wheel);}box(cart,0,.95,.05,.8,.8,.9,'#c9b08b',true);
  const packages=[],pickTargets=[...groups.floor.children.filter(mesh=>mesh.userData.slot!==undefined)];
  const highlight=new Set(options.highlight||[]);
  for(const product of E.products){
    const group=new THREE.Group();const color=COLORS[product.family];const mat=new THREE.MeshStandardMaterial({color,roughness:.8,transparent:true});
    const body=new THREE.Mesh(new THREE.BoxGeometry(2.35,1.35,1.94),mat);body.castShadow=true;body.receiveShadow=true;body.userData.product=product.id;group.add(body);pickTargets.push(body);
    box(group,0,.686,0,.21,.025,1.96,C.panel);box(group,0,0,.984,.21,1.34,.025,C.paper);
    const tag=label(group,String(product.id+1).padStart(2,'0'),.65,.05,1.01,.48,.32,C.ink,C.panel);
    group.position.copy(position(assignment[product.id]));group.userData.product=product.id;groups.products.add(group);
    const halo=new THREE.Mesh(new THREE.RingGeometry(1.42,1.54,48),new THREE.MeshBasicMaterial({color:C.accent,side:THREE.DoubleSide,transparent:true,opacity:highlight.has(product.id)?.8:0,depthWrite:false}));halo.rotation.x=-Math.PI/2;halo.position.copy(position(assignment[product.id],.2));groups.floor.add(halo);
    packages.push({group,body,mat,halo,tag,product});
  }
  function disposeGroup(group){while(group.children.length){const child=group.children.pop();child.traverse(item=>{if(item.geometry&&item.geometry!==geometry)item.geometry.dispose();if(item.material){for(const mat of Array.isArray(item.material)?item.material:[item.material]){mat.map?.dispose();if(![...materials.values()].includes(mat))mat.dispose();}}});child.parent=null;}}
  function links(){disposeGroup(groups.links);linkDots=[];if(selected<0||!connections)return;const from=packages[selected].group.position;const related=E.products.filter(p=>p.id!==selected&&flows[selected][p.id]>0).sort((a,b)=>flows[selected][b.id]-flows[selected][a.id]).slice(0,4);
    related.forEach((p,index)=>{const to=packages[p.id].group.position;const mid=from.clone().lerp(to,.5);mid.y=8+index*.55;const curve=new THREE.QuadraticBezierCurve3(from.clone().add(new THREE.Vector3(0,1,0)),mid,to.clone().add(new THREE.Vector3(0,1,0)));const tube=new THREE.Mesh(new THREE.TubeGeometry(curve,32,.06,5,false),new THREE.MeshBasicMaterial({color:C.accent,transparent:true,opacity:.88}));groups.links.add(tube);const bead=new THREE.Mesh(new THREE.SphereGeometry(.14,8,8),new THREE.MeshBasicMaterial({color:C.ink}));groups.links.add(bead);linkDots.push({bead,curve,offset:index*.23});});
  }
  function emitSelection(id){if(id<0){options.onSelect?.(null);return;}const p=E.products[id];options.onSelect?.({...p,slot:assignment[id],count:counts[id],pinned:options.pinned.includes(id),related:E.products.filter(product=>product.id!==id&&flows[id][product.id]>0).sort((a,b)=>flows[id][b.id]-flows[id][a.id]).slice(0,3).map(product=>({name:product.name,count:flows[id][product.id]}))});}
  function select(id){selected=id;links();emitSelection(id);}
  let pointerDown=null;
  const down=event=>{pointerDown={x:event.clientX,y:event.clientY};};
  const hit=event=>{const bounds=renderer.domElement.getBoundingClientRect();pointer.set((event.clientX-bounds.left)/bounds.width*2-1,-(event.clientY-bounds.top)/bounds.height*2+1);raycaster.setFromCamera(pointer,camera);return raycaster.intersectObjects(pickTargets,false)[0];};
  const up=event=>{if(!pointerDown||Math.hypot(event.clientX-pointerDown.x,event.clientY-pointerDown.y)>7)return;const intersection=hit(event);if(!intersection){select(-1);return;}const product=intersection.object.userData.product;const slot=intersection.object.userData.slot;select(product??assignment.indexOf(slot));};
  const move=event=>{if(playing)return;const intersection=hit(event);hover=intersection?intersection.object.userData.product??assignment.indexOf(intersection.object.userData.slot):-1;renderer.domElement.style.cursor=hover>=0?'pointer':'grab';};
  renderer.domElement.addEventListener('pointerdown',down);renderer.domElement.addEventListener('pointerup',up);renderer.domElement.addEventListener('pointermove',move);
  function fitZoom(eye=camera.position){
    const direction=controls.target.clone().sub(eye).normalize(),right=direction.clone().cross(camera.up).normalize(),up=right.clone().cross(direction).normalize();
    const xs=[],ys=[];for(const x of [-14,14])for(const y of [-1,5])for(const z of [-15.6,15.6]){const p=new THREE.Vector3(x,y,z);xs.push(p.dot(right));ys.push(p.dot(up));}
    return clamp(Math.min((camera.right-camera.left)/(Math.max(...xs)-Math.min(...xs)),(camera.top-camera.bottom)/(Math.max(...ys)-Math.min(...ys)))/1.08,.5,2.2);
  }
  function resize(){const width=host.clientWidth,height=host.clientHeight;if(!width||!height)return;renderer.setSize(width,height,false);const span=21.8,aspect=width/height;camera.left=-span*aspect;camera.right=span*aspect;camera.top=span;camera.bottom=-span;baseZoom=fitZoom(cameraTween?.to||camera.position);camera.zoom=baseZoom;if(cameraTween)cameraTween.targetZoom=baseZoom;camera.updateProjectionMatrix();}
  const observer=new ResizeObserver(resize);observer.observe(host);resize();
  function preset(name){const to=name==='top'?new THREE.Vector3(0,50,.01):name==='front'?new THREE.Vector3(0,16,48):new THREE.Vector3(29,29,34);controls.target.set(0,.4,0);baseZoom=fitZoom(to);cameraTween={from:camera.position.clone(),to,start:performance.now(),zoom:camera.zoom,targetZoom:baseZoom};}
  function resetPositions(){packages.forEach((entry,id)=>{entry.group.position.copy(position(assignment[id]));entry.halo.position.copy(position(assignment[id],.2));});}
  function clearRoute(){disposeGroup(groups.route);route=null;routeDots=[];}
  function taskPath(task){const a=position(task.from,.18),b=position(task.to,.18),same=Math.floor(task.from/8)===Math.floor(task.to/8);const aisleA=a.clone().add(new THREE.Vector3(2.2,0,0)),aisleB=b.clone().add(new THREE.Vector3(2.2,0,0));const cross=Math.abs(a.z+13)+Math.abs(b.z+13)<=Math.abs(a.z-13)+Math.abs(b.z-13)?-13:13;const points=same?[a,aisleA,aisleB,b]:[a,aisleA,new THREE.Vector3(aisleA.x,.18,cross),new THREE.Vector3(aisleB.x,.18,cross),aisleB,b];return points.filter((point,index)=>!index||point.distanceTo(points[index-1])>.001);}
  function prepareTask(){clearRoute();if(!simulation||taskIndex>=simulation.tasks.length){playing=false;emitSelection(selected);links();options.onPlayback?.({status:'complete',step:taskIndex,total:simulation?.tasks.length||0,progress:1,plan:simulation});return;}
    const task=simulation.tasks[taskIndex],points=taskPath(task),lengths=[0];for(let i=1;i<points.length;i++)lengths.push(lengths[i-1]+points[i].distanceTo(points[i-1]));route={task,points,lengths,total:lengths.at(-1),duration:clamp(lengths.at(-1)*.075,1.8,4.5)};
    const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),new THREE.LineDashedMaterial({color:C.accent,dashSize:.35,gapSize:.2,transparent:true,opacity:.8}));line.computeLineDistances();groups.route.add(line);
    for(const point of [points[0],points.at(-1)]){const ring=new THREE.Mesh(new THREE.RingGeometry(.5,.65,32),new THREE.MeshBasicMaterial({color:C.accent,transparent:true,opacity:.8,side:THREE.DoubleSide}));ring.rotation.x=-Math.PI/2;ring.position.copy(point);ring.position.y=.21;groups.route.add(ring);}
    for(let i=0;i<4;i++){const dot=new THREE.Mesh(new THREE.SphereGeometry(.08,8,8),new THREE.MeshBasicMaterial({color:C.ink}));groups.route.add(dot);routeDots.push(dot);}
    select(task.product);options.onPlayback?.({status:playing?'playing':'paused',step:taskIndex,total:simulation.tasks.length,progress:taskIndex/simulation.tasks.length,task,plan:simulation});
  }
  function pointAt(t){let distance=clamp(t,0,1)*route.total;for(let i=1;i<route.lengths.length;i++)if(distance<=route.lengths[i]){return route.points[i-1].clone().lerp(route.points[i],(distance-route.lengths[i-1])/(route.lengths[i]-route.lengths[i-1]));}return route.points.at(-1).clone();}
  function play(plan){if(!simulation||taskIndex>=simulation.tasks.length||plan){simulation=plan||options.getPlan();if(!simulation?.tasks.length){options.onPlayback?.({status:'empty',total:0,progress:0});return;}assignment=[...simulation.initial];resetPositions();taskIndex=0;elapsed=0;playing=true;prepareTask();}else{playing=!playing;options.onPlayback?.({status:playing?'playing':'paused',step:taskIndex,total:simulation.tasks.length,progress:(taskIndex+(route?elapsed/route.duration:0))/simulation.tasks.length,task:route?.task,plan:simulation});}}
  function stop(){playing=false;simulation=null;taskIndex=0;elapsed=0;assignment=[...options.assignment];resetPositions();clearRoute();selected=-1;links();emitSelection(-1);options.onPlayback?.({status:'idle',step:0,total:0,progress:0});}
  function tick(time){if(disposed)return;raf=requestAnimationFrame(tick);const dt=Math.min((time-lastTime)/1000,.08)||0;lastTime=time;
    if(cameraTween){const t=clamp((performance.now()-cameraTween.start)/(reduced?1:800),0,1);camera.position.lerpVectors(cameraTween.from,cameraTween.to,ease(t));camera.zoom=THREE.MathUtils.lerp(cameraTween.zoom,cameraTween.targetZoom,ease(t));camera.updateProjectionMatrix();if(t>=1)cameraTween=null;}
    if(playing&&route){elapsed+=dt*speed;const t=clamp(elapsed/route.duration,0,1),point=pointAt(ease(t)),entry=packages[route.task.product];point.y=1.26+Math.sin(Math.PI*t)*.65;entry.group.position.copy(point);entry.group.rotation.y=Math.sin(Math.PI*t)*.12;entry.halo.position.copy(point);entry.halo.position.y=.21;routeDots.forEach((dot,index)=>dot.position.copy(pointAt((time*.0002+index*.24)%1)));
      options.onProgress?.((taskIndex+t)/simulation.tasks.length);
      if(t>=1){assignment[route.task.product]=route.task.to;entry.group.position.copy(position(route.task.to));entry.group.rotation.y=0;entry.halo.position.copy(position(route.task.to,.2));taskIndex++;elapsed=0;prepareTask();}
    }
    for(const entry of packages){const active=entry.product.id===selected||entry.product.id===hover;const fade=category>=0&&entry.product.family!==category?.14:1;entry.mat.opacity=fade;if(heat){const ratio=counts[entry.product.id]/maxCount,low=ratio<.5;entry.mat.color.copy(heatStops[low?0:1]).lerp(heatStops[low?1:2],low?ratio*2:ratio*2-1);}else entry.mat.color.set(COLORS[entry.product.family]);entry.mat.emissive.set(active?C.accent:'#000000');entry.mat.emissiveIntensity=active?.25:0;entry.halo.material.opacity=active?.9:highlight.has(entry.product.id)?.65:0;entry.halo.scale.setScalar(active&&!reduced?1+Math.sin(time*.004)*.045:1);}
    linkDots.forEach(({bead,curve,offset})=>bead.position.copy(curve.getPoint((time*.00016+offset)%1)));controls.update();renderer.render(scene,camera);
  }
  document.fonts?.load("700 48px 'Barlow Condensed'").then(()=>{if(disposed)return;labelTextures.forEach(({draw,texture})=>{draw();texture.needsUpdate=true;});}).catch(()=>{});
  raf=requestAnimationFrame(tick);
  return{select,preset,play,stop,resize,setSpeed:value=>speed=value,zoom:factor=>{camera.zoom=clamp(camera.zoom*factor,.55,3.4);camera.updateProjectionMatrix();},setHeat:value=>heat=value,setConnections:value=>{connections=value;links();emitSelection(selected);},setCategory:value=>category=value,
    destroy(){disposed=true;cancelAnimationFrame(raf);observer.disconnect();controls.dispose();renderer.domElement.removeEventListener('pointerdown',down);renderer.domElement.removeEventListener('pointerup',up);renderer.domElement.removeEventListener('pointermove',move);scene.traverse(item=>{item.geometry?.dispose();if(item.material)for(const mat of Array.isArray(item.material)?item.material:[item.material]){mat.map?.dispose();mat.dispose();}});renderer.dispose();renderer.forceContextLoss();renderer.domElement.remove();}
  };
}
window.Kbit3D={create:(host,options)=>options.physical?window.KbitOperation3D.create(host,options):options.imported?createImported(host,options):create(host,options)};
