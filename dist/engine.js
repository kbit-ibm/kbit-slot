(function (root) {
  'use strict';
  const names = ['Agua mineral','Jugo de naranja','Gaseosa','Café molido','Té verde','Galletas','Chocolate','Papas fritas','Frutos secos','Barras de cereal','Detergente','Lavavajillas','Desinfectante','Esponjas','Limpiavidrios','Cuadernos','Bolígrafos','Papel A4','Carpetas','Cinta adhesiva','Champú','Jabón','Pasta dental','Crema corporal','Desodorante','Alimento perro','Alimento gato','Arena para gato','Snacks mascota','Bolsas mascota'];
  const groups = ['Bebidas','Snacks','Limpieza','Oficina','Cuidado personal','Mascotas'];
  const products = names.map((name, id) => ({ id, code:'SKU-' + String(id+1).padStart(3,'0'), name, family:Math.floor(id/5), category:groups[Math.floor(id/5)] }));
  const slotName = slot => 'ABCD'[Math.floor(slot/8)] + String(slot%8+1).padStart(2,'0');
  function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let n = Math.imul(seed ^ seed >>> 15, 1 | seed); n ^= n + Math.imul(n ^ n >>> 7, 61 | n); return ((n ^ n >>> 14) >>> 0) / 4294967296; }; }
  function shuffle(array, random) { for(let i=array.length-1;i>0;i--) { const j=Math.floor(random()*(i+1)); [array[i],array[j]]=[array[j],array[i]]; } return array; }
  function demo() {
    const random=rng(814); const free=shuffle(Array.from({length:30},(_,i)=>i).filter(i=>i<24 || i>28),random);
    const assignment=products.map(p=>p.family===2 ? 24+p.id-10 : free.pop());
    const orders=[];
    for(let i=0;i<180;i++) {
      const family=Math.floor(random()*6); const pool=shuffle(products.filter(p=>p.family===family).map(p=>p.id),random);
      const items=pool.slice(0,2+Math.floor(random()*2));
      if(random()<.38) { const candidates=products.filter(p=>p.family!==family && p.family!==2).map(p=>p.id); items.push(candidates[Math.floor(random()*candidates.length)]); }
      orders.push({id:'DEMO-'+String(i+1).padStart(3,'0'),items:[...new Set(items)]});
    }
    return {assignment,orders};
  }
  function flow(orders) {
    const matrix=products.map(()=>products.map(()=>0));
    for(const order of orders) { const items=[...new Set(order.items)]; for(let i=0;i<items.length;i++)for(let j=i+1;j<items.length;j++){matrix[items[i]][items[j]]++;matrix[items[j]][items[i]]++;} }
    return matrix;
  }
  function distance(a,b) {
    const aisleA=Math.floor(a/8),aisleB=Math.floor(b/8),rowA=a%8+1,rowB=b%8+1;
    return aisleA===aisleB ? Math.abs(rowA-rowB) : Math.abs(aisleA-aisleB)*4 + Math.min(rowA+rowB,18-rowA-rowB);
  }
  function cost(assignment,matrix) { let sum=0;for(let i=0;i<30;i++)for(let j=i+1;j<30;j++)sum+=matrix[i][j]*distance(assignment[i],assignment[j]);return sum; }
  function changed(initial,final) { return final.reduce((n,slot,id)=>n+Number(slot!==initial[id]),0); }
  function valid(assignment,initial,rules) {
    return assignment.length===30 && assignment.every(slot=>Number.isInteger(slot)&&slot>=0&&slot<31) && new Set(assignment).size===30 && changed(initial,assignment)<=rules.maxMoves &&
      (rules.pinned||[]).every(id=>assignment[id]===initial[id]) && (!rules.cleaningZone || products.filter(p=>p.family===2).every(p=>Math.floor(assignment[p.id]/8)===3));
  }
  function optimize(initial,orders,rules) {
    if(!valid(initial,initial,rules)) throw new Error('La distribución actual no cumple las reglas. Revisa los productos fijos y la zona de limpieza.');
    const matrix=flow(orders),assignment=[...initial],history=[];let current=cost(assignment,matrix);const before=current;
    for(let round=0;round<80;round++) {
      let best=current,bestAssignment=null;
      const occupancy=Array(32).fill(-1);assignment.forEach((slot,id)=>occupancy[slot]=id);
      for(let a=0;a<30;a++) {
        if(rules.pinned.includes(a))continue;
        for(let slot=0;slot<32;slot++) {
          if(slot===assignment[a])continue;const b=occupancy[slot];if(b>=0 && (b<a || rules.pinned.includes(b)))continue;
          const candidate=[...assignment];candidate[a]=slot;if(b>=0)candidate[b]=assignment[a];
          if(!valid(candidate,initial,rules))continue;
          const value=cost(candidate,matrix);if(value<best){best=value;bestAssignment=candidate;}
        }
      }
      if(!bestAssignment)break;assignment.splice(0,30,...bestAssignment);current=best;history.push(best);
    }
    return {initial:[...initial],target:assignment,before,after:current,improvement:before ? (before-current)/before*100 : 0,moved:changed(initial,assignment),history,rules:JSON.parse(JSON.stringify(rules)),tasks:makeTasks(initial,assignment)};
  }
  function makeTasks(initial,target) {
    const current=[...initial],tasks=[];let safety=0;
    while(changed(current,target)>0) {
      if(++safety>200)throw new Error('No se pudo construir una secuencia de movimientos.');
      let id=current.findIndex((slot,i)=>slot!==target[i] && !current.includes(target[i]));let temporary=false;
      if(id<0){id=current.findIndex((slot,i)=>slot!==target[i]);temporary=true;}
      const destination=temporary ? [31,...Array.from({length:31},(_,i)=>i)].find(slot=>!current.includes(slot)) : target[id];
      if(destination===undefined)throw new Error('Se necesita una ubicación libre para ejecutar los movimientos.');
      tasks.push({id:tasks.length+1,product:id,from:current[id],to:destination,temporary,done:false});current[id]=destination;
    }
    return tasks;
  }
  function confirmTask(assignment,task) {
    if(task.done || assignment[task.product]!==task.from || assignment.includes(task.to))throw new Error('La ubicación cambió o el destino está ocupado.');
    const next=[...assignment];next[task.product]=task.to;return next;
  }
  function parseCSV(text) {
    const source=text.replace(/^\uFEFF/,'');const header=source.split(/\r?\n/,1)[0];const delimiter=header.includes(';')?';':',';
    const rows=[];let row=[],field='',quoted=false;
    for(let i=0;i<source.length;i++){const ch=source[i];if(ch==='"'){if(quoted && source[i+1]==='"'){field+='"';i++;}else quoted=!quoted;}else if(ch===delimiter && !quoted){row.push(field.trim());field='';}else if((ch==='\n'||ch==='\r') && !quoted){if(ch==='\r'&&source[i+1]==='\n')i++;row.push(field.trim());if(row.some(Boolean))rows.push(row);row=[];field='';}else field+=ch;}
    if(quoted)throw new Error('Hay comillas sin cerrar en el archivo.');row.push(field.trim());if(row.some(Boolean))rows.push(row);
    if(rows.length<2)throw new Error('Incluye la cabecera y al menos un pedido.');if(rows.length>5001)throw new Error('Este prototipo admite hasta 5.000 líneas por archivo.');
    const columns=rows.shift().map(value=>value.toLowerCase());const orderColumn=columns.findIndex(v=>['order_id','pedido_id'].includes(v));const skuColumn=columns.findIndex(v=>['sku','producto_id'].includes(v));
    if(orderColumn<0||skuColumn<0)throw new Error('La cabecera debe incluir order_id y sku.');const orders=new Map();
    rows.forEach((cells,index)=>{const order=cells[orderColumn],sku=cells[skuColumn];if(!order||!sku)throw new Error('Faltan datos en la línea '+(index+2)+'.');const product=products.find(p=>p.code.toUpperCase()===sku.toUpperCase());if(!product)throw new Error('SKU desconocido en la línea '+(index+2)+': '+sku+'. Usa los SKU del catálogo demo.');if(!orders.has(order))orders.set(order,new Set());orders.get(order).add(product.id);});
    return [...orders].map(([id,items])=>({id,items:[...items]}));
  }
  const api={products,groups,slotName,demo,flow,distance,cost,changed,valid,optimize,makeTasks,confirmTask,parseCSV};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.KbitEngine=api;
})(typeof globalThis!=='undefined'?globalThis:this);
