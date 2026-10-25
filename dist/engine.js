(function (root) {
  'use strict';
  // The engine is one self-contained factory: the page uses it directly and the plan worker rebuilds it from its own source.
  function kbitEngine() {
    const names = ['Agua mineral','Jugo de naranja','Gaseosa','Café molido','Té verde','Galletas','Chocolate','Papas fritas','Frutos secos','Barras de cereal','Detergente','Lavavajillas','Desinfectante','Esponjas','Limpiavidrios','Cuadernos','Bolígrafos','Papel A4','Carpetas','Cinta adhesiva','Champú','Jabón','Pasta dental','Crema corporal','Desodorante','Alimento perro','Alimento gato','Arena para gato','Snacks mascota','Bolsas mascota'];
    const groups = ['Bebidas','Snacks','Limpieza','Oficina','Cuidado personal','Mascotas'];
    const catalog = names.map((name, id) => ({ id, code:'SKU-' + String(id+1).padStart(3,'0'), name, family:Math.floor(id/5), category:groups[Math.floor(id/5)] }));
    // Plan of the demo warehouse. See docs/CONTRATO-MOTOR.md for every field.
    const DEFAULT_LAYOUT = Object.freeze({ version:1, aisles:Object.freeze(['A','B','C','D']), bays:8, levels:1, aisleSpacing:4, levelCost:1, reserved:Object.freeze(['D08']) });
    const CLEANING_ZONE = Object.freeze({ id:'limpieza', label:'Limpieza en pasillo D', families:Object.freeze([2]), aisles:Object.freeze(['D']) });
    const isCount = (value, min) => Number.isInteger(value) && value >= min;
    const now = () => typeof performance !== 'undefined' ? performance.now() : Date.now();
    const abortError = () => Object.assign(new Error('Cálculo cancelado.'), { name:'AbortError' });
    let workerURL = null;
    function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let n = Math.imul(seed ^ seed >>> 15, 1 | seed); n ^= n + Math.imul(n ^ n >>> 7, 61 | n); return ((n ^ n >>> 14) >>> 0) / 4294967296; }; }
    function shuffle(array, random) { for(let i=array.length-1;i>0;i--) { const j=Math.floor(random()*(i+1)); [array[i],array[j]]=[array[j],array[i]]; } return array; }

    function createLayout(spec = {}) {
      const layout = { ...DEFAULT_LAYOUT, ...spec };
      const { aisles, bays, levels, aisleSpacing, levelCost } = layout;
      if(!Array.isArray(aisles) || !aisles.length || aisles.some(a => typeof a !== 'string' || !a) || new Set(aisles).size !== aisles.length) throw new Error('El plano necesita al menos un pasillo y nombres de pasillo únicos.');
      if(!isCount(bays,1) || !isCount(levels,1)) throw new Error('Las posiciones por pasillo y los niveles deben ser enteros positivos.');
      if(!(aisleSpacing > 0) || !(levelCost >= 0)) throw new Error('La separación entre pasillos debe ser positiva y el costo por nivel no puede ser negativo.');
      // Slot index = (aisle × bays + bay) × levels + level, so a one-level plan keeps the historical numbering A01 = 0 … D08 = 31.
      const slots = [];
      aisles.forEach((label, aisle) => { for(let bay=0;bay<bays;bay++) for(let level=0;level<levels;level++) slots.push({ index:slots.length, aisle, bay, level, name:label + String(bay+1).padStart(2,'0') + (levels > 1 ? '-' + (level+1) : '') }); });
      const byName = new Map(slots.map(slot => [slot.name, slot.index]));
      // A name without level ("D08") means level 1 when the plan has several levels ("D08-1").
      const slotIndex = name => byName.get(name) ?? (levels > 1 ? byName.get(name + '-1') : undefined);
      const reserved = [...new Set((layout.reserved || []).map(name => { const index = slotIndex(name); if(index === undefined) throw new Error('La reserva ' + name + ' no existe en el plano.'); return index; }))];
      // Walking distance: along the aisle inside it; otherwise through the closest cross aisle (front or back), plus a cost per level of height difference.
      const turn = 2 * (bays + 1);
      const distances = slots.map(a => Float64Array.from(slots, b => {
        const rowA = a.bay + 1, rowB = b.bay + 1;
        const floor = a.aisle === b.aisle ? Math.abs(rowA - rowB) : Math.abs(a.aisle - b.aisle) * aisleSpacing + Math.min(rowA + rowB, turn - rowA - rowB);
        return floor + levelCost * Math.abs(a.level - b.level);
      }));
      return {
        spec:{ version:1, aisles:[...aisles], bays, levels, aisleSpacing, levelCost, reserved:reserved.map(index => slots[index].name) },
        slots, slotCount:slots.length, distances, reserved, assignable:slots.map(slot => slot.index).filter(index => !reserved.includes(index)),
        slotName:index => slots[index]?.name, slotIndex, distance:(a, b) => distances[a][b]
      };
    }

    function createInstance(spec = {}) {
      const layout = createLayout(spec.layout);
      const products = spec.products || catalog, families = spec.groups || groups, n = products.length, D = layout.distances;
      if(!n || products.some((p, i) => p.id !== i || !isCount(p.family,0))) throw new Error('Los productos deben numerarse de 0 a n−1 y tener una familia.');
      if(n > layout.assignable.length) throw new Error('Hay más productos (' + n + ') que posiciones asignables (' + layout.assignable.length + ').');
      const transfer = { layout:layout.spec, products:spec.products, groups:spec.groups };

      function flow(orders) {
        const matrix=products.map(()=>products.map(()=>0));
        for(const order of orders) { const items=[...new Set(order.items)]; for(let i=0;i<items.length;i++)for(let j=i+1;j<items.length;j++){matrix[items[i]][items[j]]++;matrix[items[j]][items[i]]++;} }
        return matrix;
      }
      function cost(assignment, matrix) { let sum=0;for(let i=0;i<n;i++)for(let j=i+1;j<n;j++)sum+=matrix[i][j]*D[assignment[i]][assignment[j]];return sum; }
      function changed(initial, final) { return final.reduce((count, slot, id) => count + Number(slot !== initial[id]), 0); }

      // Rules: maxMoves, pinned products and zones. The legacy flag cleaningZone means the zone "family 2 in aisle D".
      function compileRules(rules = {}) {
        const zones = Array.isArray(rules.zones) ? rules.zones : rules.cleaningZone ? [CLEANING_ZONE] : [];
        const allowed = products.map(() => null);
        for(const zone of zones) {
          const title = zone.label || zone.id || 'sin nombre';
          const aisles = zone.aisles?.map(label => { const aisle = layout.spec.aisles.indexOf(label); if(aisle < 0) throw new Error('La zona ' + title + ' usa el pasillo ' + label + ', que no existe en el plano.'); return aisle; });
          const levels = zone.levels?.map(level => { if(!isCount(level,1) || level > layout.spec.levels) throw new Error('La zona ' + title + ' usa el nivel ' + level + ', que no existe en el plano.'); return level - 1; });
          const named = zone.slots?.map(name => { const index = layout.slotIndex(name); if(index === undefined) throw new Error('La zona ' + title + ' usa la posición ' + name + ', que no existe en el plano.'); return index; });
          const inside = layout.slots.map(slot => (!aisles || aisles.includes(slot.aisle)) && (!levels || levels.includes(slot.level)) && (!named || named.includes(slot.index)));
          for(const p of products) if(zone.families?.includes(p.family) || zone.products?.includes(p.id)) allowed[p.id] = allowed[p.id] ? allowed[p.id].map((ok, slot) => ok && inside[slot]) : inside;
        }
        const assignable = new Uint8Array(layout.slotCount); layout.assignable.forEach(index => assignable[index] = 1);
        const inZone = (product, slot) => !allowed[product] || allowed[product][slot];
        return { maxMoves:rules.maxMoves ?? Infinity, pinned:new Set(rules.pinned || []), zones, inZone, fits:(product, slot) => assignable[slot] === 1 && inZone(product, slot) };
      }
      function valid(assignment, initial, rules) {
        const R = compileRules(rules);
        return assignment.length === n && assignment.every((slot, id) => Number.isInteger(slot) && slot >= 0 && slot < layout.slotCount && R.fits(id, slot)) && new Set(assignment).size === n &&
          changed(initial, assignment) <= R.maxMoves && [...R.pinned].every(id => assignment[id] === initial[id]);
      }

      // Index change of moving product a to an empty slot, or of swapping a and b, in O(n) instead of recomputing all pairs. Requires symmetric distances.
      function deltaMove(assignment, matrix, a, slot) { const from=D[assignment[a]],to=D[slot],flows=matrix[a];let delta=0;for(let k=0;k<n;k++)if(k!==a){const s=assignment[k];delta+=flows[k]*(to[s]-from[s]);}return delta; }
      function deltaSwap(assignment, matrix, a, b) { const from=D[assignment[a]],to=D[assignment[b]],fa=matrix[a],fb=matrix[b];let delta=0;for(let k=0;k<n;k++)if(k!==a&&k!==b){const s=assignment[k];delta+=(fa[k]-fb[k])*(to[s]-from[s]);}return delta; }

      // Mutable search state: assignment, slot occupancy, index and relocated count, all updated incrementally.
      function createSearch(initial, matrix, R, start) {
        const p=[...start],occupancy=new Int32Array(layout.slotCount).fill(-1),F=matrix.map(row=>Float64Array.from(row));p.forEach((slot,id)=>occupancy[slot]=id);
        const search={ p, occupancy, cost:cost(p,matrix), moved:changed(initial,p), evaluations:0,
          movedDelta(a,slot,b){ const s=p[a];let d=(slot!==initial[a])-(s!==initial[a]);if(b>=0)d+=(s!==initial[b])-(slot!==initial[b]);return d; },
          feasible(a,slot,b){ return R.fits(a,slot) && (b<0 || (!R.pinned.has(b) && R.fits(b,p[a]))) && search.moved+search.movedDelta(a,slot,b)<=R.maxMoves; },
          delta(a,slot,b){ search.evaluations++;return b>=0 ? deltaSwap(p,F,a,b) : deltaMove(p,F,a,slot); },
          apply(a,slot,b,delta){ const s=p[a];search.moved+=search.movedDelta(a,slot,b);p[a]=slot;occupancy[slot]=a;if(b>=0){p[b]=s;occupancy[s]=b;}else occupancy[s]=-1;search.cost+=delta; }
        };
        return search;
      }
      // Best-improvement descent: each round applies the single move or swap that lowers the index the most.
      function descend(search, R, movable, rounds, history) {
        const {p,occupancy}=search;
        for(let round=0;round<rounds;round++) {
          let best=0,move=null;
          for(const a of movable) for(let slot=0;slot<layout.slotCount;slot++) {
            if(slot===p[a])continue;const b=occupancy[slot];if(b>=0 && (b<a || R.pinned.has(b)))continue;
            if(!search.feasible(a,slot,b))continue;const delta=search.delta(a,slot,b);if(delta<best){best=delta;move=[a,slot,b];}
          }
          if(!move)return;search.apply(...move,best);history.push(search.cost);
        }
      }

      // Step-wise solver: the work runs in slices so a caller can report progress, cancel, or keep the page responsive.
      function createSolver(initial, orders, rules, options = {}) {
        if(!valid(initial,initial,rules)) throw new Error('La distribución actual no cumple las reglas. Revisa los productos fijos y la zona de limpieza.');
        const R=compileRules(rules),matrix=flow(orders),search=createSearch(initial,matrix,R,initial),history=[],before=search.cost,started=now();
        const movable=products.map(p=>p.id).filter(id=>!R.pinned.has(id));
        let phase='voraz',rounds=0,elapsed=0;
        const status=()=>({ done:phase==='listo', phase, progress:phase==='listo' ? 1 : 0, before, best:search.cost, evaluations:search.evaluations, elapsed });
        return {
          step(budget = Infinity) {
            const deadline=now()+budget;
            do {
              const last=history.length;descend(search,R,movable,1,history);rounds++;
              if(history.length===last || rounds>=80) phase='listo';
            } while(phase==='voraz' && now()<deadline);
            elapsed=now()-started;return status();
          },
          result() {
            if(phase!=='listo') throw new Error('El cálculo todavía no terminó.');
            const target=[...search.p],after=cost(target,matrix);
            if(Math.abs(after-search.cost)>1e-6*Math.max(1,before) || !valid(target,initial,rules)) throw new Error('El cálculo incremental no coincide con el índice. Informa este caso.');
            return {initial:[...initial],target,before,after,improvement:before ? (before-after)/before*100 : 0,moved:changed(initial,target),history,rules:JSON.parse(JSON.stringify(rules)),tasks:makeTasks(initial,target,rules),
              solver:{ id:'voraz', label:'Búsqueda voraz', evaluations:search.evaluations, milliseconds:Math.round(elapsed) }};
          }
        };
      }
      function optimize(initial, orders, rules, options) { const solver=createSolver(initial,orders,rules,options);while(!solver.step().done);return solver.result(); }

      // Same plan as optimize, computed in a Web Worker so the page never freezes. Without workers it runs in slices on the page.
      // options: onProgress(status), signal (AbortSignal) and the solver settings.
      function solveAsync(initial, orders, rules, options = {}) {
        const { onProgress, signal, ...settings } = options;
        return new Promise((resolve, reject) => {
          if(signal?.aborted) return reject(abortError());
          const onPage = () => {
            let solver;try { solver=createSolver(initial,orders,rules,settings); } catch(error) { return reject(error); }
            const slice = () => {
              if(signal?.aborted) return reject(abortError());
              try { const state=solver.step(25);onProgress?.(state);if(state.done) resolve(solver.result());else setTimeout(slice,0); } catch(error) { reject(error); }
            };
            setTimeout(slice,0);
          };
          let worker;
          try {
            if(typeof Worker!=='function') return onPage();
            workerURL ||= URL.createObjectURL(new Blob(['const E=(' + kbitEngine + ')();\n(' + workerMain + ')(self,E);'], { type:'text/javascript' }));
            worker=new Worker(workerURL);
          } catch { return onPage(); }
          let answered=false;
          const finish = () => { worker.terminate();signal?.removeEventListener('abort',abort); };
          const abort = () => { finish();reject(abortError()); };
          signal?.addEventListener('abort',abort,{ once:true });
          worker.onmessage = ({ data }) => {
            answered=true;
            if(data.type==='progress') onProgress?.(data.state);
            else { finish();if(data.type==='result') resolve(data.plan);else reject(new Error(data.message)); }
          };
          worker.onerror = event => { event.preventDefault?.();finish();if(answered) reject(new Error(event.message || 'El cálculo se interrumpió.'));else onPage(); };
          worker.postMessage({ spec:transfer, initial, orders, rules, options:settings });
        });
      }

      // Moves products one at a time; a cycle borrows a free slot, reserved slots first, preferring one inside the product's zone.
      function makeTasks(initial, target, rules) {
        const R = rules ? compileRules(rules) : null, order = [...layout.reserved, ...layout.assignable];
        const current=[...initial],tasks=[];let safety=0;
        while(changed(current,target)>0) {
          if(++safety>Math.max(200,4*n))throw new Error('No se pudo construir una secuencia de movimientos.');
          let id=current.findIndex((slot,i)=>slot!==target[i] && !current.includes(target[i]));let temporary=false;
          if(id<0){id=current.findIndex((slot,i)=>slot!==target[i]);temporary=true;}
          const free=temporary ? order.filter(slot=>!current.includes(slot)) : [];
          const destination=temporary ? (free.find(slot=>!R || R.inZone(id,slot)) ?? free[0]) : target[id];
          if(destination===undefined)throw new Error('Se necesita una ubicación libre para ejecutar los movimientos.');
          tasks.push({id:tasks.length+1,product:id,from:current[id],to:destination,temporary,done:false});current[id]=destination;
        }
        return tasks;
      }
      function confirmTask(assignment, task) {
        if(task.done || assignment[task.product]!==task.from || assignment.includes(task.to))throw new Error('La ubicación cambió o el destino está ocupado.');
        const next=[...assignment];next[task.product]=task.to;return next;
      }

      // Demo data: cleaning products start in the first five bays of the last aisle and the rest are shuffled over the ground level.
      function demo() {
        const random=rng(814), last=layout.spec.aisles.length-1, ground=layout.assignable.filter(slot=>layout.slots[slot].level===0);
        const cleaningSlots=ground.filter(slot=>layout.slots[slot].aisle===last).slice(0,5), cleaning=products.filter(p=>p.family===2).map(p=>p.id);
        const free=shuffle(ground.filter(slot=>!cleaningSlots.includes(slot)).slice(0,n-cleaning.length),random);
        const assignment=products.map(p=>p.family===2 ? cleaningSlots[cleaning.indexOf(p.id)] : free.pop());
        const orders=[];
        for(let i=0;i<180;i++) {
          const family=Math.floor(random()*families.length); const pool=shuffle(products.filter(p=>p.family===family).map(p=>p.id),random);
          const items=pool.slice(0,2+Math.floor(random()*2));
          if(random()<.38) { const candidates=products.filter(p=>p.family!==family && p.family!==2).map(p=>p.id); items.push(candidates[Math.floor(random()*candidates.length)]); }
          orders.push({id:'DEMO-'+String(i+1).padStart(3,'0'),items:[...new Set(items)]});
        }
        return {assignment,orders};
      }
      function parseCSV(text) {
        const source=text.replace(/^﻿/,'');const header=source.split(/\r?\n/,1)[0];const delimiter=header.includes(';')?';':',';
        const rows=[];let row=[],field='',quoted=false;
        for(let i=0;i<source.length;i++){const ch=source[i];if(ch==='"'){if(quoted && source[i+1]==='"'){field+='"';i++;}else quoted=!quoted;}else if(ch===delimiter && !quoted){row.push(field.trim());field='';}else if((ch==='\n'||ch==='\r') && !quoted){if(ch==='\r'&&source[i+1]==='\n')i++;row.push(field.trim());if(row.some(Boolean))rows.push(row);row=[];field='';}else field+=ch;}
        if(quoted)throw new Error('Hay comillas sin cerrar en el archivo.');row.push(field.trim());if(row.some(Boolean))rows.push(row);
        if(rows.length<2)throw new Error('Incluye la cabecera y al menos un pedido.');if(rows.length>5001)throw new Error('Este prototipo admite hasta 5.000 líneas por archivo.');
        const columns=rows.shift().map(value=>value.toLowerCase());const orderColumn=columns.findIndex(v=>['order_id','pedido_id'].includes(v));const skuColumn=columns.findIndex(v=>['sku','producto_id'].includes(v));
        if(orderColumn<0||skuColumn<0)throw new Error('La cabecera debe incluir order_id y sku.');const orders=new Map();
        rows.forEach((cells,index)=>{const order=cells[orderColumn],sku=cells[skuColumn];if(!order||!sku)throw new Error('Faltan datos en la línea '+(index+2)+'.');const product=products.find(p=>p.code.toUpperCase()===sku.toUpperCase());if(!product)throw new Error('SKU desconocido en la línea '+(index+2)+': '+sku+'. Usa los SKU del catálogo demo.');if(!orders.has(order))orders.set(order,new Set());orders.get(order).add(product.id);});
        return [...orders].map(([id,items])=>({id,items:[...items]}));
      }

      return { spec:transfer, layout, products, groups:families, slotName:layout.slotName, distance:layout.distance, zones:rules => compileRules(rules).zones,
        demo, flow, cost, deltaMove, deltaSwap, changed, valid, createSolver, optimize, solveAsync, makeTasks, confirmTask, parseCSV };
    }

    // Runs inside the worker: rebuilds the instance from its plain spec and streams progress, then the plan.
    function workerMain(scope, E) {
      scope.onmessage = ({ data }) => {
        try {
          const solver=E.createInstance(data.spec).createSolver(data.initial,data.orders,data.rules,data.options);let state;
          do { state=solver.step(50);scope.postMessage({ type:'progress', state }); } while(!state.done);
          scope.postMessage({ type:'result', plan:solver.result() });
        } catch(error) { scope.postMessage({ type:'error', message:error.message }); }
      };
    }

    return { ...createInstance(), createInstance, createLayout, DEFAULT_LAYOUT, CLEANING_ZONE };
  }
  const api = kbitEngine();
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.KbitEngine=api;
})(typeof globalThis!=='undefined'?globalThis:this);
