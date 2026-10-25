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
    // Simulated annealing: `restarts` independent chains of `iterations` steps, each from the greedy plan. Tuned on four order sets
    // (mean gap 0.05 % to near-optimal references, ~150 ms). See docs/CONTRATO-MOTOR.md. iterations: 0 keeps only the greedy descent.
    const SOLVER_DEFAULTS = Object.freeze({ seed:1, iterations:25000, restarts:32, timeLimit:5000, heat:1, chill:.01, revertRate:.05, movedRate:.15, bound:true });
    function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let n = Math.imul(seed ^ seed >>> 15, 1 | seed); n ^= n + Math.imul(n ^ n >>> 7, 61 | n); return ((n ^ n >>> 14) >>> 0) / 4294967296; }; }
    function shuffle(array, random) { for(let i=array.length-1;i>0;i--) { const j=Math.floor(random()*(i+1)); [array[i],array[j]]=[array[j],array[i]]; } return array; }

    function createLayout(spec = {}) {
      if(spec.kind==='physical')return createPhysicalLayout(spec);
      if(spec.kind === 'corridors') return corridorLayout(spec);
      if(spec.kind === 'network') return networkLayout(spec);
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
        slotName:index => slots[index]?.name, slotIndex, distance:(a, b) => distances[a][b],
        // Packing sits at the front end of the first aisle (row bays + 1), where the 3D scene draws it.
        unit:'u', depotDistance:index => { const s = slots[index]; return s.aisle * aisleSpacing + (bays - s.bay) + levelCost * s.level; }
      };
    }

    // A bounded set of real warehouse locations. Distances are supplied by the circulation adapter,
    // so the solver and its Worker use the same physical addresses as tasks and animation.
    function createPhysicalLayout(spec) {
      const {slots:input,distances:matrix}=spec;
      if(!Array.isArray(input)||input.length<2||input.length>128||!Array.isArray(matrix)||matrix.length!==input.length)throw new Error('El plano físico necesita entre 2 y 128 ubicaciones y su matriz de distancias.');
      const aisles=[...new Set(input.map(s=>s.aisleName))],levels=Math.max(...input.map(s=>s.level))+1;
      if(aisles.some(a=>typeof a!=='string'||!a)||!isCount(levels,1))throw new Error('Revisa los pasillos y niveles del plano físico.');
      const slots=input.map((s,index)=>{if(typeof s.name!=='string'||!s.name||!isCount(s.level,0)||![s.x,s.y,s.z].every(Number.isFinite))throw new Error('La ubicación física '+index+' no es válida.');return {...s,index,aisle:aisles.indexOf(s.aisleName)};});
      if(new Set(slots.map(s=>s.name)).size!==slots.length)throw new Error('Las direcciones físicas no pueden repetirse.');
      const distances=matrix.map(row=>{if(!Array.isArray(row)||row.length!==slots.length||row.some(d=>!Number.isFinite(d)||d<0))throw new Error('La matriz física contiene distancias inválidas.');return Float64Array.from(row);});
      for(let i=0;i<slots.length;i++)for(let j=0;j<slots.length;j++)if((i===j&&distances[i][j]!==0)||Math.abs(distances[i][j]-distances[j][i])>1e-6)throw new Error('Las distancias físicas deben ser simétricas y tener diagonal cero.');
      const byName=new Map(slots.map(s=>[s.name,s.index])),reserved=[...new Set((spec.reserved||[]).map(name=>{if(!byName.has(name))throw new Error('La reserva física no existe.');return byName.get(name);} ))];
      const normalized={kind:'physical',version:1,aisles,levels,slots:slots.map(({index,aisle,...s})=>s),distances:distances.map(row=>Array.from(row)),reserved:reserved.map(i=>slots[i].name)};
      return {unit:'m',spec:normalized,slots,slotCount:slots.length,distances,reserved,assignable:slots.map(s=>s.index).filter(i=>!reserved.includes(i)),slotName:i=>slots[i]?.name,slotIndex:name=>byName.get(name),distance:(a,b)=>distances[a][b]};
    }

    // A full Parallel warehouse (kind "corridors"): every location on its aisle corridor, in metres. Walking distance is
    // the difference along the corridor inside it; between corridors, the x offset plus the shortest detour through a
    // crossing (front, back or intermediate cross aisle); plus levelCost per level and accessCost between two different
    // locations (stepping from the corridor to each shelf). For Parallel designs this equals the shortest path on the
    // circulation graph of operation-model.js, in closed form, so it scales to thousands of locations.
    function corridorLayout(spec) {
      const { aisles, corridors, crossings, slots:points, levelCost = 1, accessCost = 0 } = spec;
      if(!Array.isArray(aisles) || !aisles.length || new Set(aisles).size !== aisles.length || !Array.isArray(corridors) || corridors.length !== aisles.length || !corridors.every(Number.isFinite))
        throw new Error('El diseño necesita pasillos con nombre único y la posición de cada pasillo.');
      if(!Array.isArray(crossings) || !crossings.length || !crossings.every(Number.isFinite)) throw new Error('El diseño necesita al menos un cruce entre pasillos.');
      if(!Array.isArray(points) || !points.length) throw new Error('El diseño no tiene ubicaciones.');
      if(!(levelCost >= 0) || !(accessCost >= 0)) throw new Error('Los costos por nivel y por acceso no pueden ser negativos.');
      const slots = points.map((p, index) => {
        if(typeof p.name !== 'string' || !isCount(p.aisle,0) || p.aisle >= aisles.length || !isCount(p.level,0) || !Number.isFinite(p.z)) throw new Error('La ubicación ' + index + ' del diseño no es válida.');
        return { index, aisle:p.aisle, level:p.level, z:p.z, name:p.name };
      });
      const byName = new Map(slots.map(slot => [slot.name, slot.index]));
      if(byName.size !== slots.length) throw new Error('El diseño repite nombres de ubicación.');
      const slotIndex = name => byName.get(name);
      const reserved = [...new Set((spec.reserved || []).map(name => { if(!byName.has(name)) throw new Error('La reserva ' + name + ' no existe en el diseño.'); return byName.get(name); }))];
      const distances = slots.map(a => Float32Array.from(slots, b => {
        if(a === b) return 0;
        let floor = Math.abs(a.z - b.z);
        if(a.aisle !== b.aisle) { let detour = Infinity; for(const c of crossings) detour = Math.min(detour, Math.abs(a.z - c) + Math.abs(b.z - c)); floor = Math.abs(corridors[a.aisle] - corridors[b.aisle]) + detour; }
        return floor + levelCost * Math.abs(a.level - b.level) + accessCost;
      }));
      const front = Math.max(...crossings);
      return {
        // Packing: the front crossing, at the first aisle.
        unit:'m', depotDistance:index => { const s = slots[index]; return Math.abs(corridors[s.aisle] - corridors[0]) + Math.abs(front - s.z) + levelCost * s.level + accessCost / 2; },
        spec:{ version:2, kind:'corridors', name:spec.name || '', aisles:[...aisles], corridors:[...corridors], crossings:[...crossings], levelCost, accessCost, levels:Math.max(...slots.map(s => s.level)) + 1,
          slots:points.map(p => ({ name:p.name, aisle:p.aisle, z:p.z, level:p.level })), reserved:reserved.map(index => slots[index].name) },
        slots, slotCount:slots.length, distances, reserved, assignable:slots.map(slot => slot.index).filter(index => !reserved.includes(index)),
        slotName:index => slots[index]?.name, slotIndex, distance:(a, b) => distances[a][b]
      };
    }

    // A full designed warehouse of any geometry (kind "network"): its circulation as a graph (aisles, cross aisles, the V
    // and the entrance as weighted edges between nodes), each location attached to the node in front of it with the step
    // from the aisle to the shelf (offset). Walking distance is the shortest path between both nodes, plus both offsets
    // and levelCost per level: the same metric operation-model.js uses for its sample, for thousands of locations.
    function networkLayout(spec) {
      const { aisles, nodes, edges, slots:points, levelCost = 1 } = spec;
      if(!Array.isArray(aisles) || !aisles.length || new Set(aisles).size !== aisles.length) throw new Error('El diseño necesita pasillos con nombre único.');
      if(!isCount(nodes,1) || !Array.isArray(edges) || !edges.every(e => Array.isArray(e) && isCount(e[0],0) && e[0] < nodes && isCount(e[1],0) && e[1] < nodes && e[2] >= 0 && Number.isFinite(e[2])))
        throw new Error('La circulación del diseño no es válida: cada tramo une dos nodos con una longitud no negativa.');
      if(!Array.isArray(points) || !points.length) throw new Error('El diseño no tiene ubicaciones.');
      if(!(levelCost >= 0)) throw new Error('El costo por nivel no puede ser negativo.');
      const slots = points.map((p, index) => {
        if(typeof p.name !== 'string' || !isCount(p.aisle,0) || p.aisle >= aisles.length || !isCount(p.level,0) || !isCount(p.node,0) || p.node >= nodes || !(p.offset >= 0) || !Number.isFinite(p.offset))
          throw new Error('La ubicación ' + index + ' del diseño no es válida.');
        return { index, aisle:p.aisle, level:p.level, node:p.node, offset:p.offset, name:p.name };
      });
      const byName = new Map(slots.map(slot => [slot.name, slot.index]));
      if(byName.size !== slots.length) throw new Error('El diseño repite nombres de ubicación.');
      const slotIndex = name => byName.get(name);
      const reserved = [...new Set((spec.reserved || []).map(name => { if(!byName.has(name)) throw new Error('La reserva ' + name + ' no existe en el diseño.'); return byName.get(name); }))];
      const next = Array.from({ length:nodes }, () => []);
      for(const [a, b, w] of edges) { next[a].push(b, w); next[b].push(a, w); }
      // Dijkstra with a binary heap, once from every node that holds a location.
      function shortest(from) {
        const dist = new Float64Array(nodes).fill(Infinity), heap = [[0, from]];dist[from] = 0;
        while(heap.length) {
          const [d, v] = heap[0], last = heap.pop();
          if(heap.length) { heap[0] = last;let i = 0;for(;;) { const l = 2 * i + 1, r = l + 1;let m = i;if(l < heap.length && heap[l][0] < heap[m][0]) m = l;if(r < heap.length && heap[r][0] < heap[m][0]) m = r;if(m === i) break;[heap[i], heap[m]] = [heap[m], heap[i]];i = m; } }
          if(d > dist[v]) continue;
          for(let k = 0; k < next[v].length; k += 2) {
            const to = next[v][k], nd = d + next[v][k + 1];
            if(nd < dist[to]) { dist[to] = nd;heap.push([nd, to]);let i = heap.length - 1;while(i > 0) { const p = (i - 1) >> 1;if(heap[p][0] <= heap[i][0]) break;[heap[i], heap[p]] = [heap[p], heap[i]];i = p; } }
          }
        }
        return dist;
      }
      const from = new Map();
      for(const slot of slots) if(!from.has(slot.node)) from.set(slot.node, shortest(slot.node));
      const reach = from.get(slots[0].node);
      if(slots.some(slot => !Number.isFinite(reach[slot.node]))) throw new Error('La circulación del diseño no conecta todas las ubicaciones.');
      const distances = slots.map(a => { const row = from.get(a.node);return Float32Array.from(slots, b => a === b ? 0 : row[b.node] + a.offset + b.offset + levelCost * Math.abs(a.level - b.level)); });
      // Packing: the depot node (the entrance), when the design has one.
      const depot = isCount(spec.depot,0) && spec.depot < nodes ? shortest(spec.depot) : null;
      return {
        unit:'m', depotDistance:depot ? index => { const s = slots[index];return depot[s.node] + s.offset + levelCost * s.level; } : undefined,
        spec:{ version:2, kind:'network', name:spec.name || '', aisles:[...aisles], nodes, edges:edges.map(e => [e[0], e[1], e[2]]), levelCost, levels:Math.max(...slots.map(s => s.level)) + 1,
          slots:points.map(p => ({ name:p.name, aisle:p.aisle, level:p.level, node:p.node, offset:p.offset })), reserved:reserved.map(index => slots[index].name), ...(depot ? { depot:spec.depot } : {}) },
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
      function descend(search, R, movable, rounds, record) {
        const {p,occupancy}=search;
        for(let round=0;round<rounds;round++) {
          let best=0,move=null;
          for(const a of movable) for(let slot=0;slot<layout.slotCount;slot++) {
            if(slot===p[a])continue;const b=occupancy[slot];if(b>=0 && (b<a || R.pinned.has(b)))continue;
            if(!search.feasible(a,slot,b))continue;const delta=search.delta(a,slot,b);if(delta<best){best=delta;move=[a,slot,b];}
          }
          if(!move)return;search.apply(...move,best);record(search.cost);
        }
      }

      // Step-wise solver: the work runs in slices so a caller can report progress, cancel, or keep the page responsive.
      // Phases: greedy descent (the historical method), annealing chains that each restart from the greedy plan, then a greedy polish of the best plan.
      // With a fixed seed and iteration count the plan is reproducible; timeLimit (ms) is only a safety cap.
      function createSolver(initial, orders, rules, options = {}) {
        if(!valid(initial,initial,rules)) throw new Error('La distribución actual no cumple las reglas. Revisa los productos fijos y la zona de limpieza.');
        const settings={ ...SOLVER_DEFAULTS, ...options };
        if(!isCount(settings.iterations,0) || !isCount(settings.restarts,1) || !Number.isInteger(settings.seed) || !(settings.timeLimit>0)) throw new Error('Las opciones del cálculo no son válidas: iterations, restarts y seed enteros, timeLimit positivo.');
        const R=compileRules(rules),matrix=flow(orders),history=[],trace=[],started=now(),random=rng(settings.seed),total=settings.iterations*settings.restarts;
        // Convergence: every new best index, with the evaluations spent so far and the phase that found it.
        const record=value=>{history.push(value);trace.push({evaluations:search.evaluations,index:value,phase});};
        const movable=products.map(p=>p.id).filter(id=>!R.pinned.has(id)),candidates=products.map(p=>layout.assignable.filter(slot=>R.fits(p.id,slot)));
        let search=createSearch(initial,matrix,R,initial),phase='voraz',rounds=0,iteration=0,chain=0,chainEnd=0,elapsed=0,temperature=0,cooling=1,timeLimited=false,greedy=null;
        const before=search.cost;let best=[...initial],bestCost=before,greedyCost=before,bound=null;
        trace.push({evaluations:0,index:before,phase:'inicio'});

        function restart(from) { const evaluations=search.evaluations;search=createSearch(initial,matrix,R,from);search.evaluations=evaluations; }
        function pickMoved() { let k=Math.floor(random()*search.moved);for(const a of movable)if(search.p[a]!==initial[a] && k--===0)return a;return movable[0]; }
        // Random neighbour: put a product back in its original slot, move a relocated product, or move any product; swaps happen when the slot is taken.
        function propose() {
          const r=random(),relocated=search.moved>0;
          if(relocated && r<settings.revertRate){ const a=pickMoved();return [a,initial[a]]; }
          const a=relocated && r<settings.revertRate+settings.movedRate ? pickMoved() : movable[Math.floor(random()*movable.length)],slots=candidates[a];
          return [a,slots[Math.floor(random()*slots.length)]];
        }
        function neighbour() { const [a,slot]=propose(),b=search.occupancy[slot];return slot!==search.p[a] && search.feasible(a,slot,b) ? [a,slot,b] : null; }
        // Starting temperature: average worsening of random feasible moves around the greedy plan, so the schedule adapts to any order volume.
        function calibrate() {
          let sum=0,count=0;
          for(let i=0;i<400;i++){ const move=neighbour();if(!move)continue;const delta=search.delta(...move);if(delta>0){sum+=delta;count++;} }
          temperature=count ? sum/count*settings.heat : 1;cooling=Math.pow(settings.chill,1/Math.max(1,settings.iterations));
        }
        function anneal(stop) {
          for(;iteration<stop;iteration++,temperature*=cooling) {
            const move=neighbour();if(!move)continue;const delta=search.delta(...move);
            if(delta<=0 || random()<Math.exp(-delta/temperature)){ search.apply(...move,delta);if(search.cost<bestCost-1e-9){ bestCost=search.cost;best=[...search.p];record(bestCost); } }
          }
        }
        function status() {
          const fraction=phase==='voraz' ? 0 : phase==='recocido' ? .04+.92*Math.min(1,Math.max(iteration/total,elapsed/settings.timeLimit)) : phase==='pulido' ? .97 : phase==='cota' ? .98 : 1;
          return { done:phase==='listo', phase, progress:fraction, before, best:Math.min(bestCost,search.cost), evaluations:search.evaluations, iteration, elapsed };
        }
        return {
          step(budget = Infinity) {
            const deadline=now()+budget;
            do {
              if(phase==='voraz') {
                const last=history.length;descend(search,R,movable,1,record);rounds++;
                if(history.length===last || rounds>=80){ greedyCost=bestCost=search.cost;best=[...search.p];greedy=[...search.p];phase=settings.iterations>0 && movable.length ? 'recocido' : settings.bound ? 'cota' : 'listo';if(phase==='recocido'){ chainEnd=settings.iterations;calibrate(); } }
              } else if(phase==='recocido') {
                anneal(Math.min(chainEnd,iteration+2048));
                timeLimited=iteration<total && now()-started>=settings.timeLimit;
                if(iteration>=chainEnd && ++chain<settings.restarts && !timeLimited){ restart(greedy);chainEnd+=settings.iterations;calibrate(); }
                else if(iteration>=chainEnd || timeLimited){ restart(best);phase='pulido'; }
              } else if(phase==='pulido') {
                const last=history.length;descend(search,R,movable,1,record);
                if(history.length===last)phase=settings.bound ? 'cota' : 'listo';else{ bestCost=search.cost;best=[...search.p]; }
              } else {
                bound=lowerBound(initial,orders,rules,matrix);phase='listo';
              }
              elapsed=now()-started;
            } while(phase!=='listo' && now()<deadline);
            return status();
          },
          result() {
            if(phase!=='listo') throw new Error('El cálculo todavía no terminó.');
            const target=[...search.p],after=cost(target,matrix);
            if(Math.abs(after-search.cost)>1e-6*Math.max(1,before) || !valid(target,initial,rules)) throw new Error('El cálculo incremental no coincide con el índice. Informa este caso.');
            const annealed=settings.iterations>0 && movable.length>0;
            return planObject(initial,orders,matrix,rules,target,before,after,history,{ id:annealed ? 'voraz+recocido' : 'voraz', label:annealed ? 'Voraz + recocido simulado' : 'Búsqueda voraz', seed:settings.seed, iterations:iteration,
              evaluations:search.evaluations, milliseconds:Math.round(elapsed), greedy:greedyCost, timeLimited, trace:thin(trace,200) },bound);
          }
        };
      }
      // Keeps the first and last points and spreads the rest evenly, so a long convergence trace stays small in storage.
      function thin(points, limit) { if(points.length<=limit)return points;const step=(points.length-1)/(limit-1);return Array.from({length:limit},(_,i)=>points[Math.round(i*step)]); }
      function planObject(initial, orders, matrix, rules, target, before, after, history, solver, bound = null) {
        const tasks=makeTasks(initial,target,rules);
        return {initial:[...initial],target:[...target],before,after,improvement:before ? (before-after)/before*100 : 0,moved:changed(initial,target),history,rules:JSON.parse(JSON.stringify(rules)),tasks,solver,
          bound:bound ? { ...bound, gap:bound.value>0 ? Math.max(0,(after-bound.value)/bound.value*100) : null } : null, metrics:operations(initial,target,tasks,matrix,orders)};
      }
      // A target computed elsewhere (server, quantum sampler) becomes a plan only after passing the same rules and a full recomputation of the index.
      function planFrom(initial, orders, rules, target, solver = {}) {
        if(!valid(initial,initial,rules)) throw new Error('La distribución actual no cumple las reglas. Revisa los productos fijos y la zona de limpieza.');
        if(!Array.isArray(target) || !valid(target,initial,rules)) throw new Error('La propuesta recibida no cumple las reglas y se descartó.');
        const matrix=flow(orders),before=cost(initial,matrix),after=cost(target,matrix);
        // An external solver may prove its own bound (the MILP's dual bound); it is shown as reported, never trusted for the plan.
        const bound=solver?.bound && Number.isFinite(solver.bound.value) ? { value:Math.min(solver.bound.value,after), method:String(solver.bound.method || 'externa') } : null;
        return planObject(initial,orders,matrix,rules,target,before,after,[before,after],JSON.parse(JSON.stringify(solver)),bound);
      }
      // The problem as plain JSON for external solvers: the same distances, co-occurrence flows and rules the engine applies.
      function describe(initial, orders, rules) {
        if(!valid(initial,initial,rules)) throw new Error('La distribución actual no cumple las reglas. Revisa los productos fijos y la zona de limpieza.');
        const R=compileRules(rules),matrix=flow(orders);
        return { version:1, products:n, slots:layout.slotCount, slotNames:layout.slots.map(slot=>slot.name), assignable:[...layout.assignable], reserved:[...layout.reserved],
          distances:D.map(row=>Array.from(row)), flow:matrix, allowed:products.map(p=>layout.assignable.filter(slot=>R.fits(p.id,slot))),
          pinned:[...R.pinned].sort((a,b)=>a-b), maxMoves:Number.isFinite(R.maxMoves) ? R.maxMoves : null, initial:[...initial], cost:cost(initial,matrix) };
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

      // Moves products one at a time, with the forklift in mind. The number of steps is minimal: one per relocated product
      // plus one per cycle (products that occupy each other's destinations). Among the moves whose destination is already
      // free, the next one starts nearest to where the previous move ended. A cycle borrows a free slot, reserved slots
      // first and inside the product's zone, choosing the product and slot that add the least walking. An or-opt pass then
      // shortens the empty walk between tasks.
      function makeTasks(initial, target, rules) {
        const R = rules ? compileRules(rules) : null, current=[...initial], tasks=[], occupant=new Map(current.map((slot,id)=>[slot,id]));
        const walk=(from,to)=>from===null ? 0 : D[from][to];
        let position=null,safety=0,remaining=products.map(p=>p.id).filter(id=>current[id]!==target[id]);
        while(remaining.length) {
          if(++safety>Math.max(200,4*n))throw new Error('No se pudo construir una secuencia de movimientos.');
          const ready=remaining.filter(id=>!occupant.has(target[id]));
          let id,destination,temporary=false;
          if(ready.length) { id=ready.reduce((best,next)=>walk(position,current[next])<walk(position,current[best]) ? next : best);destination=target[id]; }
          else {
            const free=[...layout.reserved,...layout.assignable].filter(slot=>!occupant.has(slot));
            if(!free.length)throw new Error('Se necesita una ubicación libre para ejecutar los movimientos.');
            let choice=null;
            for(const candidate of remaining) {
              const inZone=free.filter(slot=>!R || R.inZone(candidate,slot)),reserved=inZone.filter(slot=>layout.reserved.includes(slot));
              const pool=reserved.length ? reserved : inZone.length ? inZone : free;
              for(const slot of pool) {
                const extra=walk(position,current[candidate])+D[current[candidate]][slot]+D[slot][target[candidate]]-D[current[candidate]][target[candidate]];
                if(!choice || extra<choice.extra-1e-9) choice={ id:candidate, slot, extra };
              }
            }
            ({ id, slot:destination }=choice);temporary=true;
          }
          tasks.push({id:tasks.length+1,product:id,from:current[id],to:destination,temporary,done:false});
          occupant.delete(current[id]);occupant.set(destination,id);current[id]=destination;position=destination;
          remaining=remaining.filter(other=>current[other]!==target[other]);
        }
        return shorterOrder(tasks,initial);
      }
      // Or-opt over the sequence: moves one task to another place while every task still finds its product at the origin
      // and its destination free, as long as the empty walk between tasks gets shorter (up to 200 tasks).
      function shorterOrder(tasks, initial) {
        const empty=list=>{ let sum=0;for(let k=1;k<list.length;k++)sum+=D[list[k-1].to][list[k].from];return sum; };
        const feasible=list=>{ const at=[...initial],occupied=new Set(initial);for(const t of list){ if(at[t.product]!==t.from || occupied.has(t.to))return false;occupied.delete(t.from);occupied.add(t.to);at[t.product]=t.to; }return true; };
        let order=tasks,best=empty(order),improved=tasks.length<=200;
        while(improved) {
          improved=false;
          for(let i=0;i<order.length;i++)for(let j=0;j<order.length;j++)if(i!==j) {
            const trial=[...order],[task]=trial.splice(i,1);trial.splice(j,0,task);const value=empty(trial);
            if(value<best-1e-9 && feasible(trial)){ order=trial;best=value;improved=true; }
          }
        }
        return order.map((task,k)=>({ ...task, id:k+1 }));
      }
      // Operational view of a plan, in the layout's unit ('u' plan units, 'm' metres): forklift travel for its tasks
      // (loaded and empty), the picking route per order before and after (from packing and back when the layout knows
      // where packing is), and the product pairs and products whose order-weighted distance improved most.
      function operations(initial, target, tasks, matrix, orders) {
        let loaded=0,empty=0,last=null;
        for(const t of tasks){ if(last!==null)empty+=D[last][t.from];loaded+=D[t.from][t.to];last=t.to; }
        const depot=layout.depotDistance;
        // Shortest visit of an order's slots: exact over every visiting order up to 6 slots, nearest neighbour beyond.
        function route(slots) {
          const s=[...new Set(slots)],ends=i=>depot ? depot(s[i]) : 0;
          if(!s.length)return 0;
          if(s.length<=6) {
            let best=Infinity;const used=new Uint8Array(s.length),path=[];
            const visit=length=>{
              if(length>=best)return;
              if(path.length===s.length){ best=Math.min(best,length+ends(path.at(-1)));return; }
              for(let i=0;i<s.length;i++)if(!used[i]){ used[i]=1;const step=path.length ? D[s[path.at(-1)]][s[i]] : ends(i);path.push(i);visit(length+step);path.pop();used[i]=0; }
            };
            visit(0);return best;
          }
          const left=new Set(s.keys());let at=[...left].reduce((a,b)=>ends(b)<ends(a)?b:a),length=ends(at);left.delete(at);
          while(left.size){ const next=[...left].reduce((a,b)=>D[s[at]][s[b]]<D[s[at]][s[a]]?b:a);length+=D[s[at]][s[next]];at=next;left.delete(at); }
          return length+ends(at);
        }
        const picking=assignment=>orders.length ? orders.reduce((sum,order)=>sum+route(order.items.map(id=>assignment[id])),0)/orders.length : 0;
        const before=picking(initial),after=picking(target),pairs=[],gains=new Float64Array(n);
        for(let i=0;i<n;i++)for(let j=i+1;j<n;j++)if(matrix[i][j]){
          const gain=matrix[i][j]*(D[initial[i]][initial[j]]-D[target[i]][target[j]]);
          if(Math.abs(gain)>1e-9){ pairs.push({ a:i, b:j, orders:matrix[i][j], before:D[initial[i]][initial[j]], after:D[target[i]][target[j]], gain });gains[i]+=gain;gains[j]+=gain; }
        }
        pairs.sort((x,y)=>y.gain-x.gain);
        return { unit:layout.unit, relocation:{ tasks:tasks.length, temporary:tasks.filter(t=>t.temporary).length, loaded, empty, total:loaded+empty },
          picking:{ before, after, change:before ? (before-after)/before*100 : 0, fromPacking:!!depot, orders:orders.length },
          bestPairs:pairs.slice(0,5), worstPairs:pairs.filter(p=>p.gain<0).slice(-3).reverse(),
          products:[...gains].map((gain,id)=>({ id, gain })).filter(p=>Math.abs(p.gain)>1e-9).sort((x,y)=>y.gain-x.gain).slice(0,5) };
      }
      // Hungarian algorithm (Kuhn–Munkres with potentials) for n rows and m ≥ n columns: the cheapest assignment of every row.
      function hungarian(costs, rows, columns) {
        const u=new Float64Array(rows+1),v=new Float64Array(columns+1),owner=new Int32Array(columns+1),way=new Int32Array(columns+1);
        for(let i=1;i<=rows;i++) {
          owner[0]=i;let j0=0;const minimum=new Float64Array(columns+1).fill(Infinity),used=new Uint8Array(columns+1);
          do {
            used[j0]=1;const i0=owner[j0],row=costs[i0-1];let delta=Infinity,j1=0;
            for(let j=1;j<=columns;j++)if(!used[j]){ const reduced=row[j-1]-u[i0]-v[j];if(reduced<minimum[j]){ minimum[j]=reduced;way[j]=j0; }if(minimum[j]<delta){ delta=minimum[j];j1=j; } }
            for(let j=0;j<=columns;j++)if(used[j]){ u[owner[j]]+=delta;v[j]-=delta; }else minimum[j]-=delta;
            j0=j1;
          } while(owner[j0]!==0);
          do { const j1=way[j0];owner[j0]=owner[j1];j0=j1; } while(j0);
        }
        const assignment=new Int32Array(rows);for(let j=1;j<=columns;j++)if(owner[j])assignment[owner[j]-1]=j-1;
        let total=0;for(let i=0;i<rows;i++)total+=costs[i][assignment[i]];
        return { assignment, total };
      }
      // Gilmore–Lawler lower bound under the plan's rules. Pinned products are exact: their pairs are a constant and their
      // pairs with a movable product at slot k a known cost. Among movable products, product i at k costs at least half the
      // smallest scalar product of its order flows (largest first) with k's distances to the other free slots (shortest
      // first); the cheapest assignment of those per-product costs is below every plan's index. Zones restrict the slots,
      // and the relocation limit enters through a Lagrangian dual: max over λ ≥ 0 of LAP(cost + λ·moved) − λ·limit.
      // With a relocation limit M there is a second bound: only pairs that touch a moved product change, and each such pair
      // can at best shrink to the shortest distance it could reach (to a pinned product's slot, or between two free slots);
      // so the index drops by at most the M largest per-product sums of those reductions. The larger of the two is returned.
      // Every plan that respects the rules costs at least this value, so (plan − bound) / bound caps the distance to the optimum.
      function lowerBound(initial, orders, rules, matrix = flow(orders)) {
        const R=compileRules(rules),BIG=1e12,movable=products.map(p=>p.id).filter(id=>!R.pinned.has(id)),pinned=[...R.pinned];
        const held=new Set(pinned.map(id=>initial[id])),slots=layout.assignable.filter(slot=>!held.has(slot)),q=movable.length,m=slots.length;
        let constant=0;for(let a=0;a<pinned.length;a++)for(let b=a+1;b<pinned.length;b++)constant+=matrix[pinned[a]][pinned[b]]*D[initial[pinned[a]]][initial[pinned[b]]];
        const method='Gilmore–Lawler';
        if(!q)return { value:constant, method, lambda:0 };
        const flows=movable.map(i=>{ const row=new Float64Array(q-1);let c=0;for(const j of movable)if(j!==i)row[c++]=matrix[i][j];return row.sort().reverse(); });
        const near=slots.map(k=>{ const row=new Float64Array(m-1);let c=0;for(const l of slots)if(l!==k)row[c++]=D[k][l];return row.sort().slice(0,q-1); });
        const base=movable.map((i,a)=>slots.map((k,c)=>{
          if(!R.fits(i,k))return BIG;
          const f=flows[a],d=near[c];let sum=0;for(let r=0;r<q-1;r++)sum+=f[r]*d[r];
          let fixed=0;for(const p of pinned)fixed+=matrix[i][p]*D[k][initial[p]];
          return sum/2+fixed;
        }));
        const limit=Number.isFinite(R.maxMoves) ? R.maxMoves : null;
        const solve=lambda=>{
          const costs=base.map((row,a)=>row.map((value,c)=>value+(slots[c]===initial[movable[a]] ? 0 : lambda)));
          const { assignment, total }=hungarian(costs,q,m);let moved=0;for(let a=0;a<q;a++)moved+=slots[assignment[a]]!==initial[movable[a]];
          return { value:constant+total-lambda*(limit ?? 0), moved };
        };
        let best=solve(0),lambda=0;
        if(limit!==null && best.moved>limit) {
          let low=0,high=1;while(solve(high).moved>limit && high<1e9)high*=4;
          for(let k=0;k<18;k++){ const mid=(low+high)/2,trial=solve(mid);if(trial.value>best.value){ best=trial;lambda=mid; }if(trial.moved>limit)low=mid;else high=mid; }
          const top=solve(high);if(top.value>best.value){ best=top;lambda=high; }
        }
        const gilmore={ value:Math.max(0,best.value), method:method+(lambda>0 ? ' con límite de movimientos (dual lagrangiano)' : ''), lambda };
        if(limit===null)return gilmore;
        let shortest=Infinity;for(let a=0;a<m;a++)for(let b=a+1;b<m;b++)shortest=Math.min(shortest,D[slots[a]][slots[b]]);
        const reach=new Map(pinned.map(p=>[p,Math.min(...slots.map(k=>D[k][initial[p]]))]));
        const savings=movable.map(i=>{ let sum=0;for(let j=0;j<n;j++)if(j!==i && matrix[i][j])sum+=matrix[i][j]*Math.max(0,D[initial[i]][initial[j]]-(reach.has(j) ? reach.get(j) : shortest));return sum; }).sort((a,b)=>b-a);
        const budget=cost(initial,matrix)-savings.slice(0,limit).reduce((a,b)=>a+b,0);
        return budget>gilmore.value ? { value:budget, method:'Límite de movimientos: índice actual menos el mayor ahorro posible de '+limit+' productos', lambda } : gilmore;
      }
      function confirmTask(assignment, task) {
        if(task.done || assignment[task.product]!==task.from || assignment.includes(task.to))throw new Error('La ubicación cambió o el destino está ocupado.');
        const next=[...assignment];next[task.product]=task.to;return next;
      }

      // Demo data: cleaning products start in the first ground slots of the last aisle and the rest are shuffled over the
      // ground level (in a designed warehouse, over the whole ground level; in the demo plan, over its first free slots).
      function demo() {
        // Cleaning products start on the ground of one aisle: the last one, or in a network design (diagonal aisles of uneven
        // length) the one with most ground locations.
        const ground=layout.assignable.filter(slot=>layout.slots[slot].level===0),count=aisle=>ground.filter(slot=>layout.slots[slot].aisle===aisle).length;
        const random=rng(814), last=layout.spec.kind==='network' ? layout.spec.aisles.reduce((best,_,aisle)=>count(aisle)>=count(best) ? aisle : best,0) : layout.spec.aisles.length-1;
        const cleaning=products.filter(p=>p.family===2).map(p=>p.id), cleaningSlots=ground.filter(slot=>layout.slots[slot].aisle===last).slice(0,cleaning.length);
        const others=ground.filter(slot=>!cleaningSlots.includes(slot));
        if(cleaningSlots.length<cleaning.length || others.length<n-cleaning.length) throw new Error('El piso del almacén no tiene lugar para los datos de ejemplo.');
        const free=['corridors','network'].includes(layout.spec.kind) ? shuffle(others,random).slice(0,n-cleaning.length) : shuffle(others.slice(0,n-cleaning.length),random);
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
        demo, flow, cost, deltaMove, deltaSwap, changed, valid, createSolver, optimize, solveAsync, planFrom, describe, makeTasks, lowerBound, confirmTask, parseCSV };
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

    return { ...createInstance(), createInstance, createLayout, DEFAULT_LAYOUT, CLEANING_ZONE, SOLVER_DEFAULTS };
  }
  const api = kbitEngine();
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.KbitEngine=api;
})(typeof globalThis!=='undefined'?globalThis:this);
