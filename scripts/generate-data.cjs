'use strict';
const fs = require('node:fs');
const path = require('node:path');
const E = require('../dist/engine.js');

function generate({ name, products: count, orders: orderCount, bays, seed, solver, maxMoves }) {
  let state = seed;
  const random = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296);
  const pick = xs => xs[Math.floor(random() * xs.length)];
  const shuffle = xs => {
    for (let i = xs.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [xs[i], xs[j]] = [xs[j], xs[i]];
    }
    return xs;
  };
  const products = Array.from({ length: count }, (_, id) => {
    const base = E.products[id % E.products.length];
    return { ...base, id, code: `SKU-${String(id + 1).padStart(3, '0')}`,
      name: base.name + (id >= 30 ? ` · presentación ${Math.floor(id / 30) + 1}` : '') };
  });
  const spec = { layout: { aisles: ['A', 'B', 'C', 'D'], bays, levels: 1,
    reserved: [`D${String(bays).padStart(2, '0')}`] }, products, groups: E.groups };
  const engine = E.createInstance(spec);
  const rules = { maxMoves, pinned: count > 14 ? [0] : [], zones: [
    { id: 'limpieza', label: 'Limpieza en D', families: [2], aisles: ['D'] },
    { id: 'alimentos', label: 'Bebidas y snacks fuera de limpieza', families: [0, 1], aisles: ['A', 'B', 'C'] }
  ] };
  const available = shuffle([...engine.layout.assignable]);
  const initial = Array(count);
  // Allocate constrained families first, so the initial layout is feasible.
  const priority = products.filter(p => p.family === 2).concat(products.filter(p => p.family !== 2));
  for (const p of priority) {
    const index = available.findIndex(slot => p.family === 2 ? spec.layout.aisles[engine.layout.slots[slot].aisle] === 'D'
      : p.family <= 1 ? spec.layout.aisles[engine.layout.slots[slot].aisle] !== 'D' : true);
    if (index < 0) throw new Error(`No hay ubicación para ${p.code}`);
    initial[p.id] = available.splice(index, 1)[0];
  }
  const families = E.groups.map((_, family) => products.filter(p => p.family === family).map(p => p.id)).filter(x => x.length);
  const bundles = [[0, 5, 6], [3, 4, 9], [10, 11, 13], [15, 16, 17], [20, 21, 22], [25, 26, 28]]
    .map(items => items.filter(id => id < count)).filter(items => items.length > 1);
  const orders = [], lines = [];
  for (let i = 0; i < orderCount; i++) {
    const id = `PED-${String(i + 1).padStart(5, '0')}`;
    const items = new Set([i % count]);
    const family = pick(families);
    const size = 1 + Math.floor(random() * Math.min(6, count));
    if (random() < .65) for (const product of pick(bundles)) items.add(product);
    while (items.size < size) {
      // A family preference and hot first SKUs introduce unequal demand.
      const pool = random() < .65 ? family : products.map(p => p.id);
      items.add(random() < .35 ? pool[0] : pick(pool));
    }
    const order = { id, items: [...items] };
    orders.push(order);
    for (const product of order.items) lines.push({ order_id: id, sku: products[product].code,
      quantity: 1 + Math.floor(random() * 5), date: `2026-09-${String(1 + Math.floor(i * 30 / orderCount)).padStart(2, '0')}` });
  }
  const request = { spec, initial, orders, rules, solver,
    options: solver === 'exacto' ? { timeLimit: 30 } : { seed, iterations: 2500, restarts: 4 } };
  if (!engine.valid(initial, initial, rules)) throw new Error('Distribución inicial inválida');
  return { name, seed, request, lines, engine };
}

const scenarios = [
  { name: 'milp-8', products: 8, orders: 150, bays: 4, seed: 20261025, solver: 'exacto', maxMoves: 4 },
  { name: 'demo-30', products: 30, orders: 500, bays: 8, seed: 20261026, solver: 'clasico', maxMoves: 12 },
  { name: 'almacen-1000', products: 1000, orders: 10000, bays: 280, seed: 20261027, solver: 'clasico', maxMoves: 50 }
];
const csv = rows => rows.map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\n') + '\n';
function writeAll() {
  for (const config of scenarios) {
    const { name, request, lines, engine, seed } = generate(config);
    const folder = path.join(__dirname, '..', 'data', name);
    fs.mkdirSync(folder, { recursive: true });
    const write = (file, value) => fs.writeFileSync(path.join(folder, file), value);
    write('request.json', JSON.stringify(request, null, 2) + '\n');
    write('products.csv', csv([['id', 'sku', 'name', 'family'], ...request.spec.products.map(p => [p.id, p.code, p.name, p.category])]));
    write('locations.csv', csv([['index', 'address', 'aisle', 'level', 'reserved'], ...engine.layout.slots.map(s => [s.index, s.name, request.spec.layout.aisles[s.aisle], s.level + 1, engine.layout.reserved.includes(s.index)])]));
    write('assignment.csv', csv([['sku', 'location'], ...request.initial.map((slot, id) => [request.spec.products[id].code, engine.slotName(slot)])]));
    write('orders.csv', csv([['order_id', 'sku', 'quantity', 'date'], ...lines.map(l => [l.order_id, l.sku, l.quantity, l.date])]));
    write('metadata.json', JSON.stringify({ synthetic: true, source: 'Generado localmente; nombres del catálogo demo, sin BD externa',
      seed, products: request.initial.length, orders: request.orders.length, lines: lines.length,
      locations: engine.layout.slotCount, initialIndex: engine.cost(request.initial, engine.flow(request.orders)),
      units: 'u del plano, no metros', quantityUsedByObjective: false }, null, 2) + '\n');
    console.log(`${name}: ${request.initial.length} productos, ${request.orders.length} pedidos, ${lines.length} líneas`);
  }
}
if (require.main === module) writeAll();
module.exports = { generate, scenarios };
