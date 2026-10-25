import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {importedLayout} from './imported-layout.mjs';

// One draw call for the catalogue and one for shelves, independent of SKU count.
export function createImported(host,options) {
  const E=options.engine,layout=importedLayout(E),css=getComputedStyle(document.documentElement);
  const token=(name,fallback)=>css.getPropertyValue('--'+name).trim()||fallback;
  const colors=E.groups.map((_,i)=>token('fam-'+i,'#686357'));
  const scene=new THREE.Scene(),renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});
  renderer.setPixelRatio(Math.min(devicePixelRatio,1.6));renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.domElement.setAttribute('role','img');
  renderer.domElement.setAttribute('aria-label','Almacén importado en 3D. Arrastra para girar, acerca con la rueda o selecciona un sector.');
  host.append(renderer.domElement);
  scene.add(new THREE.HemisphereLight(0xffffff,0x8a8070,2.5));
  const sun=new THREE.DirectionalLight(0xffffff,3);sun.position.set(-20,40,15);scene.add(sun);
  const camera=new THREE.OrthographicCamera(-20,20,20,-20,.01,10000);
  const controls=new OrbitControls(camera,renderer.domElement);
  controls.enableDamping=true;controls.minPolarAngle=.02;controls.maxPolarAngle=Math.PI/2.1;
  controls.minZoom=.25;controls.maxZoom=40;
  const geometry=new THREE.BoxGeometry(1,1,1),matrix=new THREE.Matrix4(),rotation=new THREE.Quaternion();
  const make=(color,roughness=.85)=>new THREE.MeshStandardMaterial({color,roughness});
  const floor=new THREE.Mesh(geometry,make(token('panel','#fbf8f1')));
  floor.scale.set(layout.width,.15,layout.depth);floor.position.y=-.12;scene.add(floor);
  const shelves=new THREE.InstancedMesh(geometry,make(token('rule','#d3c9b6')),E.layout.slotCount);
  E.layout.slots.forEach(s=>{
    const p=layout.point(s.index,.3);
    matrix.compose(new THREE.Vector3(p.x,p.y,p.z),rotation,new THREE.Vector3(1.2,.12,.92));
    shelves.setMatrixAt(s.index,matrix);
  });shelves.computeBoundingSphere();scene.add(shelves);
  const cartons=new THREE.InstancedMesh(geometry,make('#ffffff'),E.products.length);
  cartons.instanceMatrix.setUsage(THREE.DynamicDrawUsage);scene.add(cartons);
  const marker=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({color:token('accent','#dc4f1a'),wireframe:true,depthTest:false}));
  marker.scale.set(1,.95,.9);marker.visible=false;marker.renderOrder=3;scene.add(marker);
  let assignment=[...options.assignment],selected=-1,heat=false,category=-1,connections=false,flows=null;
  let extent={x:0,z:0,width:layout.width,depth:layout.depth},view='isometric',disposed=false,raf=0,last=0;
  let simulation=null,index=0,elapsed=0,playing=false,speed=1,route=null,line=null,linkGroup=new THREE.Group();scene.add(linkGroup);
  const counts=Array(E.products.length).fill(0);
  for(const order of options.orders)for(const id of new Set(order.items))counts[id]++;
  const maxCount=Math.max(1,...counts),vector=p=>new THREE.Vector3(p.x,p.y,p.z);
  function put(id,p){matrix.compose(vector(p),rotation,new THREE.Vector3(.85,.78,.72));cartons.setMatrixAt(id,matrix);cartons.instanceMatrix.needsUpdate=true;}
  function resetPositions(){assignment.forEach((slot,id)=>put(id,layout.point(slot)));cartons.computeBoundingSphere();}
  resetPositions();
  function styles(){
    for(const p of E.products){
      const color=heat?new THREE.Color(token('heat-0','#ecdcae')).lerp(new THREE.Color(token('crit','#b3281d')),counts[p.id]/maxCount):new THREE.Color(colors[p.family]);
      if(category>=0&&category!==p.family)color.lerp(new THREE.Color(token('panel','#fbf8f1')),.85);
      if(options.highlight?.includes(p.id))color.lerp(new THREE.Color(token('accent','#dc4f1a')),.3);
      cartons.setColorAt(p.id,color);
    }cartons.instanceColor.needsUpdate=true;
  }styles();
  function clearLinks(){for(const child of [...linkGroup.children]){child.geometry.dispose();child.material.dispose();linkGroup.remove(child);}}
  function related(){
    if(selected<0)return [];
    flows??=E.flow(options.orders);
    return E.products.filter(p=>p.id!==selected&&flows[selected][p.id]>0).sort((a,b)=>flows[selected][b.id]-flows[selected][a.id]).slice(0,4);
  }
  function links(){
    clearLinks();if(!connections||selected<0)return;
    const a=vector(layout.point(assignment[selected]));
    for(const p of related()){
      const b=vector(layout.point(assignment[p.id])),mid=a.clone().lerp(b,.5);mid.y=4;
      const curve=new THREE.QuadraticBezierCurve3(a,mid,b);
      linkGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(24)),new THREE.LineBasicMaterial({color:token('accent','#dc4f1a')})));
    }
  }
  function emit(){
    if(selected<0){options.onSelect?.(null);return;}
    options.onSelect?.({...E.products[selected],slot:assignment[selected],count:counts[selected],pinned:options.pinned.includes(selected),
      related:connections?related().map(p=>({name:p.name,count:flows[selected][p.id]})):[]});
  }
  function resize(){
    const w=host.clientWidth,h=host.clientHeight;if(!w||!h)return;
    renderer.setSize(w,h,false);
    const aspect=w/h,span=Math.max(extent.depth*.7,extent.width*.7/aspect,5);
    camera.left=-span*aspect;camera.right=span*aspect;camera.top=span;camera.bottom=-span;camera.updateProjectionMatrix();
  }
  function frame(){
    const size=Math.max(extent.width,extent.depth,10);
    controls.target.set(extent.x,.4,extent.z);
    camera.position.set(extent.x+(view==='top'?0:size),view==='top'?size*2:size,extent.z+(view==='top'?.001:size));
    camera.zoom=1;resize();controls.update();
  }
  function focusSector(value){
    const bays=E.layout.spec.bays,sector=Number(value),size=24;
    if(sector<0)extent={x:0,z:0,width:layout.width,depth:layout.depth};
    else{const start=Math.min(Math.max(0,sector*size),bays-1),end=Math.min(bays,start+size);
      extent={x:0,z:(start+end-1)/2-(bays-1)/2,width:layout.width,depth:end-start+3};}
    options.onFocus?.(sector<0?null:'Sector '+(sector+1));frame();
  }
  function select(id){
    selected=Number.isInteger(id)&&id>=0&&id<E.products.length?id:-1;marker.visible=selected>=0;
    if(selected>=0){marker.position.copy(vector(layout.point(assignment[selected])));if(!playing&&E.layout.spec.bays>24)focusSector(Math.floor(E.layout.slots[assignment[selected]].bay/24));}
    links();emit();
  }
  const ray=new THREE.Raycaster(),pointer=new THREE.Vector2();let down=null;
  const pointerDown=e=>{down={x:e.clientX,y:e.clientY};};
  const pointerUp=e=>{
    if(!down||Math.hypot(e.clientX-down.x,e.clientY-down.y)>6)return;
    const r=renderer.domElement.getBoundingClientRect();pointer.set((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1);
    ray.setFromCamera(pointer,camera);select(ray.intersectObject(cartons)[0]?.instanceId??-1);
  };
  renderer.domElement.addEventListener('pointerdown',pointerDown);renderer.domElement.addEventListener('pointerup',pointerUp);
  function clearRoute(){if(line){line.geometry.dispose();line.material.dispose();scene.remove(line);line=null;}route=null;}
  function notify(status){options.onPlayback?.({status,step:index,total:simulation?.tasks.length||0,progress:simulation?.tasks.length?(index+(route?elapsed/route.duration:0))/simulation.tasks.length:0,task:simulation?.tasks[index],plan:simulation});}
  function prepare(){
    clearRoute();if(index>=simulation.tasks.length){playing=false;notify('complete');return;}
    const task=simulation.tasks[index],points=layout.route(task.from,task.to).map(vector),lengths=[0];
    for(let i=1;i<points.length;i++)lengths.push(lengths[i-1]+points[i].distanceTo(points[i-1]));
    route={points,lengths,total:lengths.at(-1),duration:Math.min(6,Math.max(2,lengths.at(-1)*.04))};
    line=new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),new THREE.LineBasicMaterial({color:token('accent','#dc4f1a'),depthTest:false}));scene.add(line);
    select(task.product);const a=points[0],b=points.at(-1);
    extent={x:(a.x+b.x)/2,z:(a.z+b.z)/2,width:Math.max(layout.width,Math.abs(a.x-b.x)+4),depth:Math.abs(a.z-b.z)+8};frame();notify(playing?'playing':'paused');
  }
  function play(plan){
    if(plan||!simulation||index>=simulation.tasks.length){
      simulation=plan;if(!simulation?.tasks.length){notify('empty');return;}
      assignment=[...simulation.initial];resetPositions();index=0;elapsed=0;playing=true;prepare();
    }else{playing=!playing;notify(playing?'playing':'paused');}last=0;
  }
  function stop(){playing=false;simulation=null;assignment=[...options.assignment];index=0;elapsed=0;clearRoute();resetPositions();select(-1);notify('idle');}
  const observer=new ResizeObserver(resize);observer.observe(host);focusSector(E.layout.spec.bays>24?0:-1);
  function tick(time){
    if(disposed)return;raf=requestAnimationFrame(tick);const dt=last?Math.min((time-last)/1000,.1):0;last=time;
    if(playing&&route){
      elapsed+=dt*speed;const fraction=Math.min(1,elapsed/route.duration),distance=fraction*route.total;
      let point=route.points.at(-1);
      for(let i=1;i<route.lengths.length;i++)if(distance<=route.lengths[i]&&route.lengths[i]>route.lengths[i-1]){point=route.points[i-1].clone().lerp(route.points[i],(distance-route.lengths[i-1])/(route.lengths[i]-route.lengths[i-1]));break;}
      const id=simulation.tasks[index].product;put(id,point);marker.position.copy(point);
      options.onProgress?.((index+fraction)/simulation.tasks.length);
      if(fraction>=1){assignment[id]=simulation.tasks[index].to;resetPositions();index++;elapsed=0;prepare();}
    }
    controls.update();renderer.render(scene,camera);
  }raf=requestAnimationFrame(tick);
  return {resize,select,play,stop,focusSector,focusAll:()=>focusSector(-1),preset(name){view=name;frame();},zoom(factor){camera.zoom=THREE.MathUtils.clamp(camera.zoom*factor,.25,40);camera.updateProjectionMatrix();},
    setSpeed:value=>speed=value,setHeat(value){heat=value;styles();},setCategory(value){category=value;styles();},setConnections(value){connections=value;links();emit();},
    destroy(){disposed=true;cancelAnimationFrame(raf);observer.disconnect();controls.dispose();clearRoute();clearLinks();renderer.domElement.removeEventListener('pointerdown',pointerDown);renderer.domElement.removeEventListener('pointerup',pointerUp);
      const geometries=new Set(),materials=new Set();scene.traverse(o=>{if(o.geometry)geometries.add(o.geometry);if(o.material)materials.add(o.material);if(o.isInstancedMesh)o.dispose();});geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());renderer.dispose();renderer.domElement.remove();}
  };
}
