(function(root) {
  'use strict';
  function validate(data, Base) {
    const fail = message => { throw new Error(message); };
    if (!data || !data.spec || !Array.isArray(data.spec.products) || !Array.isArray(data.spec.groups)) fail('Incluye spec.products y spec.groups.');
    const products = data.spec.products;
    if (!products.length || products.length > 2000) fail('Se admiten entre 1 y 2.000 productos.');
    if (!data.spec.layout || data.spec.layout.kind || data.spec.layout.levels !== 1) fail('Importa un plano rectangular de un nivel.');
    const l = data.spec.layout;
    if (!Array.isArray(l.aisles) || !l.aisles.every(a => typeof a === 'string' && /^[A-Za-z0-9_-]{1,20}$/.test(a))) fail('Usa nombres de pasillo de hasta 20 letras, números, guiones o guiones bajos.');
    if (!Array.isArray(l.aisles) || !Number.isInteger(l.bays) || l.aisles.length * l.bays > 2000) fail('El plano admite hasta 2.000 ubicaciones.');
    const codes = new Set();
    for (const [id, p] of products.entries()) {
      if (!p || p.id !== id || typeof p.code !== 'string' || !p.code.trim() || codes.has(p.code.toUpperCase()) || typeof p.name !== 'string' || !p.name.trim() || !Number.isInteger(p.family) || p.family < 0 || p.family >= data.spec.groups.length) fail('Catálogo inválido: revisa IDs consecutivos, códigos únicos, nombres y familias.');
      codes.add(p.code.toUpperCase());
    }
    if (!data.spec.groups.every(g => typeof g === 'string' && g.trim())) fail('Las familias deben tener nombre.');
    if (!Array.isArray(data.orders) || !data.orders.length || data.orders.length > 20000) fail('Se admiten entre 1 y 20.000 pedidos.');
    const ids = new Set();
    for (const o of data.orders) {
      if (!o || !['string', 'number'].includes(typeof o.id) || !String(o.id).trim() || ids.has(String(o.id)) || !Array.isArray(o.items) || !o.items.length || o.items.length > 500 || new Set(o.items).size !== o.items.length || !o.items.every(id => Number.isInteger(id) && id >= 0 && id < products.length)) fail('Pedido inválido: revisa IDs únicos y referencias al catálogo.');
      ids.add(String(o.id));
    }
    const rules = data.rules;
    if (!rules || !Array.isArray(rules.pinned) || !rules.pinned.every(id => Number.isInteger(id) && id >= 0 && id < products.length) || !Number.isInteger(rules.maxMoves) || rules.maxMoves < 0 || rules.maxMoves > products.length) fail('Reglas inválidas: incluye maxMoves y pinned.');
    const engine = Base.createInstance(data.spec);
    if (!Array.isArray(data.initial) || !engine.valid(data.initial, data.initial, rules)) fail('La distribución inicial no cumple las ubicaciones, reservas o zonas.');
    return { engine, assignment: [...data.initial], orders: data.orders, rules };
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { validate };
  else root.KbitDataset = { validate };
})(typeof window !== 'undefined' ? window : globalThis);
