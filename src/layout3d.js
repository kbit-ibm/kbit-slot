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
  const geometry=new THREE.BoxGeometry(1,1,1),matrix=new THREE.Matrix4(),q=new THREE.Quaternion(),ray=new THREE.Raycaster(),pointer=new THREE.Vector2();
  let group=new THREE.Group(),pick=null,items=[],selection=null,config,sector,extent,view='iso',disposed=false,raf,down=null;
  scene.add(group);
  const marker=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({color:C.accent,wireframe:true,depthTest:false}));marker.renderOrder=3;marker.visible=false;scene.add(marker);
  function batch(boxes,tint,opacity=1){
    if(!boxes.length)return null;
    const mat=new THREE.MeshStandardMaterial({color:tint,roughness:.8,transparent:opacity<1,opacity});
    const mesh=new THREE.InstancedMesh(geometry,mat,boxes.length);
    boxes.forEach((b,i)=>{matrix.compose(new THREE.Vector3(b.x,b.y,b.z),q,new THREE.Vector3(b.w,b.h,b.d));mesh.setMatrixAt(i,matrix);if(b.color)mesh.setColorAt(i,new THREE.Color(b.color));});
    mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingBox();mesh.computeBoundingSphere();group.add(mesh);return mesh;
  }
  function cleanup(){group.traverse(o=>{if(o.isInstancedMesh)o.dispose();if(o.material){o.material.map?.dispose();o.material.dispose();}});scene.remove(group);group=new THREE.Group();scene.add(group);}
  function sectorLabel(s,height){const canvas=document.createElement('canvas');canvas.width=192;canvas.height=80;const context=canvas.getContext('2d');context.fillStyle=C.ink;context.fillRect(0,0,192,80);context.fillStyle=C.paper;context.font='600 48px sans-serif';context.textAlign='center';context.textBaseline='middle';context.fillText(s.id,96,42);const map=new THREE.CanvasTexture(canvas);map.colorSpace=THREE.SRGBColorSpace;const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map,depthTest:false}));const width=Math.min(s.width*.5,s.depth*.6,8);sprite.scale.set(width,width*80/192,1);sprite.position.set(s.x,height+width*.25,s.z);sprite.renderOrder=2;group.add(sprite);}
  function update(value,sectorId=null){
    config=M.normalize(value);sector=sectorId;cleanup();marker.visible=false;selection=null;
    const stats=M.summary(config),sectors=M.sectors(config),focused=sectors.find(s=>s.id===sectorId);
    extent=focused?{x:focused.x,z:focused.z,w:focused.width+3,d:focused.depth+5}:{x:0,z:0,w:stats.width,d:stats.depth};
    batch([{x:extent.x,y:-.18,z:extent.z,w:extent.w,h:.3,d:extent.d}],C.rule);
    batch([{x:extent.x,y:-.01,z:extent.z,w:extent.w-.1,h:.08,d:extent.d-.1}],C.panel);
    const stripe=[];
    if(!focused){stripe.push({x:0,y:.05,z:stats.depth/2-5,w:stats.width-3,h:.04,d:.13});for(let i=0;i<Math.min(10,config.aisles);i++)stripe.push({x:-stats.width/2+2+(i+.5)*(stats.width-4)/Math.min(10,config.aisles),y:.08,z:stats.depth/2-2,w:(stats.width-4)/Math.min(10,config.aisles)*.72,h:.1,d:2});}
    batch(stripe,C.accent);
    if(stats.overview&&!focused){
      items=sectors;const rows=[],bands=[],pads=[];
      for(const [i,s] of items.entries()){
        pads.push({x:s.x,y:.07,z:s.z,w:s.width-.2,h:.05,d:s.depth-.2,color:i%2?C.paper:C.rule});
        // Continuous row volumes stand in for shelf detail in the building overview.
        for(const r of M.racks(config,s.id).filter(r=>r.bay===s.bStart)){
          rows.push({x:r.x,y:stats.height/2,z:s.z,w:config.rackDepth,h:stats.height,d:s.depth-.15});
          for(const y of [.25,stats.height/2,stats.height-.15])bands.push({x:r.x,y,z:s.z,w:config.rackDepth+.04,h:.12,d:s.depth-.1});
        }
      }
      batch(pads,C.rule);batch(rows,C.steel);batch(bands,C.accent);
      pick=batch(items.map(s=>({x:s.x,y:stats.height/2,z:s.z,w:s.width,h:stats.height,d:s.depth})),C.accent,0);pick.material.depthWrite=false;
      items.forEach(s=>sectorLabel(s,stats.height));
    }else{
      items=M.racks(config,sectorId);const posts=[],beams=[],shelves=[],boxes=[];
      for(const r of items){
        const w=config.rackDepth,d=config.bayWidth-.08,h=stats.height;
        for(const dx of [-1,1])for(const dz of [-1,1])posts.push({x:r.x+dx*(w/2-.035),y:h/2,z:r.z+dz*(d/2-.035),w:.07,h,d:.07});
        for(let l=0;l<config.levels;l++){
          const y=.16+l*config.levelHeight;
          shelves.push({x:r.x,y,z:r.z,w,h:.05,d});
          for(const dx of [-1,1])beams.push({x:r.x+dx*w/2,y:y+.035,z:r.z,w:.06,h:.12,d});
          // Two sample cartons per shelf communicate scale without allocating every location.
          for(let p=0;p<Math.min(2,config.positions);p++)if((r.bay+r.aisle+l+p)%5!==0)boxes.push({x:r.x,y:y+config.levelHeight*.31,z:r.z+(p-(Math.min(2,config.positions)-1)/2)*d*.46,w:w*.75,h:config.levelHeight*.52,d:d/(Math.min(2,config.positions)+.6),color:(r.aisle+l)%3===0?'#b9a27a':C.rule});
        }
      }
      batch(posts,C.steel);batch(beams,C.accent);batch(shelves,C.ink);batch(boxes,C.rule);
      pick=batch(items.map(r=>({x:r.x,y:stats.height/2,z:r.z,w:config.rackDepth,h:stats.height,d:config.bayWidth-.08})),C.accent,0);
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
    const s=selection,h=M.summary(config).height;marker.position.set(s.x,h/2,s.z);marker.scale.set(s.width??config.rackDepth+.14,h+.15,s.depth??config.bayWidth);draw();
  }
  const onDown=e=>{down=[e.clientX,e.clientY];};
  const onUp=e=>{if(!down||Math.hypot(e.clientX-down[0],e.clientY-down[1])>6)return;down=null;const rect=renderer.domElement.getBoundingClientRect();pointer.set((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1);ray.setFromCamera(pointer,camera);const hit=pick&&ray.intersectObject(pick)[0];if(hit&&hit.instanceId!==undefined){const item=items[hit.instanceId];if(item.aStart!==undefined)options.onSector?.(item.id);else{select(item.id);options.onRack?.(item);}}};
  renderer.domElement.addEventListener('pointerdown',onDown);renderer.domElement.addEventListener('pointerup',onUp);
  const observer=new ResizeObserver(()=>{resize();draw();});observer.observe(host);
  // Render on demand. Orbit damping keeps a short animation alive after interaction.
  let frames=0;
  function draw(){if(disposed)return;frames=24;if(!raf)raf=requestAnimationFrame(tick);}
  function tick(){raf=null;if(disposed)return;controls.update();renderer.render(scene,camera);if(--frames>0&&!raf)raf=requestAnimationFrame(tick);}
  controls.addEventListener('change',draw);
  return {update,select,preset:fit,zoom(factor){camera.zoom=Math.max(.4,Math.min(8,camera.zoom*factor));camera.updateProjectionMatrix();draw();},destroy(){disposed=true;cancelAnimationFrame(raf);observer.disconnect();controls.dispose();renderer.domElement.removeEventListener('pointerdown',onDown);renderer.domElement.removeEventListener('pointerup',onUp);cleanup();geometry.dispose();marker.material.dispose();renderer.dispose();renderer.forceContextLoss();renderer.domElement.remove();}};
}
window.KbitLayout3D={create};
