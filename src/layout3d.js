import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// Geometry is instanced; a large building is shown as sectors, then explored in detail.
function create(host,options){
  const M=window.KbitLayout,css=getComputedStyle(document.documentElement),color=(key,fallback)=>css.getPropertyValue('--'+key).trim()||fallback;
  const C={paper:color('paper','#f2eee4'),panel:color('panel','#fbf8f1'),ink:color('ink','#1f2328'),rule:color('rule','#d3c9b6'),accent:color('accent','#dc4f1a'),steel:color('fam-0','#2f6db0')};
  const scene=new THREE.Scene(),camera=new THREE.OrthographicCamera(-20,20,20,-20,.1,5000);
  const renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,powerPreference:'high-performance'});
  renderer.setPixelRatio(Math.min(devicePixelRatio,1.6));renderer.setClearColor(C.paper,0);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.NeutralToneMapping;
  renderer.domElement.setAttribute('role','img');renderer.domElement.setAttribute('aria-label','Diseño 3D del almacén. Arrastra para girar y usa la rueda para acercarte. Usa los controles para explorar sectores y estantes.');host.append(renderer.domElement);
  const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.dampingFactor=.1;controls.minPolarAngle=.02;controls.maxPolarAngle=Math.PI/2.1;controls.minZoom=.4;controls.maxZoom=8;controls.rotateSpeed=.65;controls.zoomSpeed=.8;
  scene.add(new THREE.HemisphereLight(0xffffff,0x9a8e7b,2.5));const sun=new THREE.DirectionalLight(0xffffff,3);sun.position.set(-30,60,20);scene.add(sun);
  const geometry=new THREE.BoxGeometry(1,1,1),matrix=new THREE.Matrix4(),q=new THREE.Quaternion(),axis=new THREE.Vector3(0,1,0),ray=new THREE.Raycaster(),pointer=new THREE.Vector2();
  let group=new THREE.Group(),pick=null,items=[],selection=null,config,sector,extent,view='iso',disposed=false,raf,down=null;
  scene.add(group);
  const marker=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({color:C.accent,wireframe:true,depthTest:false}));marker.renderOrder=3;marker.visible=false;scene.add(marker);
  function batch(boxes,tint,opacity=1){
    if(!boxes.length)return null;
    const mat=new THREE.MeshStandardMaterial({color:tint,roughness:.8,transparent:opacity<1,opacity});
    const mesh=new THREE.InstancedMesh(geometry,mat,boxes.length);
    boxes.forEach((b,i)=>{q.setFromAxisAngle(axis,b.rotation||0);matrix.compose(new THREE.Vector3(b.x,b.y,b.z),q,new THREE.Vector3(b.w,b.h,b.d));mesh.setMatrixAt(i,matrix);if(b.color)mesh.setColorAt(i,new THREE.Color(b.color));});
    mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingBox();mesh.computeBoundingSphere();group.add(mesh);return mesh;
  }
  function cleanup(){group.traverse(o=>{if(o.isInstancedMesh)o.dispose();if(o.material){o.material.map?.dispose();o.material.dispose();}});scene.remove(group);group=new THREE.Group();scene.add(group);}
  function sectorLabel(s,height){const canvas=document.createElement('canvas');canvas.width=192;canvas.height=80;const context=canvas.getContext('2d');context.fillStyle=C.ink;context.fillRect(0,0,192,80);context.fillStyle=C.paper;context.font='600 48px sans-serif';context.textAlign='center';context.textBaseline='middle';context.fillText(s.id,96,42);const map=new THREE.CanvasTexture(canvas);map.colorSpace=THREE.SRGBColorSpace;const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map,depthTest:false}));const width=Math.min(s.width*.5,s.depth*.6,8);sprite.scale.set(width,width*80/192,1);sprite.position.set(s.x,height+width*.25,s.z);sprite.renderOrder=2;group.add(sprite);}
  function local(r,x,y,z,w,h,d,color){const cs=Math.cos(r.rotation),sn=Math.sin(r.rotation);return {x:r.x+x*cs+z*sn,y,z:r.z-x*sn+z*cs,w,h,d,color,rotation:r.rotation};}
  function update(value,sectorId=null){
    config=M.normalize(value);sector=sectorId;cleanup();marker.visible=false;selection=null;
    const stats=M.summary(config),sectors=M.sectors(config),focused=sectors.find(s=>s.id===sectorId);
    extent=focused?{x:focused.x,z:focused.z,w:focused.width+3,d:focused.depth+5}:{x:0,z:0,w:stats.width,d:stats.depth};
    batch([{x:extent.x,y:-.18,z:extent.z,w:extent.w,h:.3,d:extent.d}],C.rule);
    batch([{x:extent.x,y:-.01,z:extent.z,w:extent.w-.1,h:.08,d:extent.d-.1}],C.panel);
    const stripe=[];
    if(!focused){stripe.push({x:0,y:.05,z:stats.depth/2-5,w:stats.width-3,h:.04,d:.13});for(let i=0;i<Math.min(10,config.aisles);i++)stripe.push({x:-stats.width/2+2+(i+.5)*(stats.width-4)/Math.min(10,config.aisles),y:.08,z:stats.depth/2-2,w:(stats.width-4)/Math.min(10,config.aisles)*.72,h:.1,d:2});}
    batch(stripe,C.accent);
    const roads=M.paths(config,{x:extent.x,z:extent.z,width:extent.w,depth:extent.d}).map(p=>({...M.pathRect(p),y:.07,h:.02}));
    batch(roads,C.accent,.13);batch(roads.map(r=>({...r,y:.085,w:.07})),C.accent);
    if(stats.overview&&!focused){
      const runs=M.runs(config),rows=runs.map(r=>({...r,y:stats.height/2,h:stats.height})),posts=[],decks=[],bands=[],cartons=[];
      const levels=[...new Set([0,Math.floor((config.levels-1)/2),config.levels-1])];
      for(const r of runs){
        for(const x of [-r.w/2,r.w/2])for(const z of [-r.d/2,0,r.d/2])posts.push(local(r,x,stats.height/2,z,.09,stats.height,.09));
        for(const level of levels){const y=.16+level*config.levelHeight;decks.push(local(r,0,y,0,r.w,.05,r.d));for(const x of [-r.w/2,r.w/2])bands.push(local(r,x,y+.035,0,.07,.12,r.d));cartons.push(local(r,0,y+config.levelHeight*.31,0,r.w*.75,config.levelHeight*.52,Math.min(config.bayWidth*.7,r.d*.6),'#b9a27a'));}
      }
      batch(posts,C.steel);batch(decks,C.ink);batch(bands,C.accent);batch(cartons,C.rule);
      // Picking follows the actual rotated runs, never overlapping sector bounding boxes.
      items=runs.map(r=>sectors.find(s=>s.id===r.sectorId));pick=batch(rows,C.accent,0);pick.material.depthWrite=false;
      const stride=Math.max(1,Math.ceil(sectors.length/100));sectors.filter((s,i)=>i%stride===0).forEach(s=>sectorLabel(s,stats.height));
    }else{
      items=M.racks(config,sectorId);const posts=[],beams=[],shelves=[],boxes=[];
      for(const r of items){
        const w=r.w,d=r.d,h=stats.height;
        for(const dx of [-1,1])for(const dz of [-1,1])posts.push(local(r,dx*(w/2-.035),h/2,dz*(d/2-.035),.07,h,.07));
        for(let l=0;l<config.levels;l++){
          const y=.16+l*config.levelHeight;
          shelves.push(local(r,0,y,0,w,.05,d));
          for(const dx of [-1,1])beams.push(local(r,dx*w/2,y+.035,0,.06,.12,d));
          // Two sample cartons per shelf communicate scale without allocating every location.
          for(let p=0;p<Math.min(2,config.positions);p++)if((r.bay+r.aisle+l+p)%5!==0)boxes.push(local(r,0,y+config.levelHeight*.31,(p-(Math.min(2,config.positions)-1)/2)*d*.46,w*.75,config.levelHeight*.52,d/(Math.min(2,config.positions)+.6),(r.aisle+l)%3===0?'#b9a27a':C.rule));
        }
      }
      batch(posts,C.steel);batch(beams,C.accent);batch(shelves,C.ink);batch(boxes,C.rule);
      pick=batch(items.map(r=>({...r,y:stats.height/2,h:stats.height})),C.accent,0);
      // Keep the picking volumes transparent but raycastable.
      if(pick)pick.material.depthWrite=false;
    }
    fit(view);draw();
  }
  function fit(next='iso'){
    view=next;const h=M.summary(config).height,span=Math.max(extent.w,extent.d,h*2),target=new THREE.Vector3(extent.x,h*.25,extent.z);
    controls.target.copy(target);camera.position.copy(target).add(next==='top'?new THREE.Vector3(0,span*1.7,.001):new THREE.Vector3(span*.85,span*.85,span));camera.zoom=1;resize();controls.update();
  }
  function resize(){if(disposed||!extent)return;const w=Math.max(1,host.clientWidth),h=Math.max(1,host.clientHeight),aspect=w/h;camera.lookAt(controls.target);camera.updateMatrixWorld();let maxX=0,maxY=0;for(const x of [-1,1])for(const z of [-1,1])for(const y of [0,M.summary(config).height]){const point=new THREE.Vector3(extent.x+x*extent.w/2,y,extent.z+z*extent.d/2).applyMatrix4(camera.matrixWorldInverse);maxX=Math.max(maxX,Math.abs(point.x));maxY=Math.max(maxY,Math.abs(point.y));}const size=Math.max(maxY,maxX/aspect)*1.18;camera.left=-size*aspect;camera.right=size*aspect;camera.top=size;camera.bottom=-size;camera.updateProjectionMatrix();renderer.setSize(w,h,false);}
  function select(id){
    selection=items.find(item=>item.id===id);marker.visible=Boolean(selection);if(!selection)return;
    const s=selection,h=M.summary(config).height;marker.position.set(s.x,h/2,s.z);marker.scale.set(s.w+.14,h+.15,s.d+.12);marker.rotation.y=s.rotation||0;draw();
  }
  const onDown=e=>{down=[e.clientX,e.clientY];};
  const hitAt=e=>{const rect=renderer.domElement.getBoundingClientRect();pointer.set((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1);ray.setFromCamera(pointer,camera);return pick&&ray.intersectObject(pick)[0];};
  const onUp=e=>{const start=down;down=null;if(!start||Math.hypot(e.clientX-start[0],e.clientY-start[1])>6)return;const hit=hitAt(e);if(hit&&hit.instanceId!==undefined){const item=items[hit.instanceId];if(item.aStart!==undefined)options.onSector?.(item.id);else{select(item.id);options.onRack?.(item);}}};
  const onMove=e=>{if(!down)renderer.domElement.style.cursor=hitAt(e)?'pointer':'grab';};
  renderer.domElement.addEventListener('pointerdown',onDown);renderer.domElement.addEventListener('pointerup',onUp);renderer.domElement.addEventListener('pointermove',onMove);
  const observer=new ResizeObserver(()=>{resize();draw();});observer.observe(host);
  // Render on demand. Orbit damping keeps a short animation alive after interaction.
  let frames=0;
  function draw(){if(disposed)return;frames=24;if(!raf)raf=requestAnimationFrame(tick);}
  function tick(){raf=null;if(disposed)return;controls.update();renderer.render(scene,camera);if(--frames>0&&!raf)raf=requestAnimationFrame(tick);}
  controls.addEventListener('change',draw);
  return {update,select,preset:fit,zoom(factor){camera.zoom=Math.max(.4,Math.min(8,camera.zoom*factor));camera.updateProjectionMatrix();draw();},destroy(){disposed=true;cancelAnimationFrame(raf);observer.disconnect();controls.dispose();renderer.domElement.removeEventListener('pointerdown',onDown);renderer.domElement.removeEventListener('pointerup',onUp);renderer.domElement.removeEventListener('pointermove',onMove);cleanup();geometry.dispose();marker.material.dispose();renderer.dispose();renderer.forceContextLoss();renderer.domElement.remove();}};
}
window.KbitLayout3D={create};
