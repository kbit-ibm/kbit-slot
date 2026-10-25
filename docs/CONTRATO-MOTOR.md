# Contrato del motor de reubicación

Este documento fija cómo se describe un almacén, sus productos y sus reglas ante el motor (`dist/engine.js`). La interfaz lo consume; el motor no conoce la interfaz. Si la interfaz necesita algo que no está aquí, se agrega primero al contrato.

`window.KbitEngine` (o `require('./dist/engine.js')` en Node) es la **instancia de demostración**: el plano de 4 pasillos × 8 posiciones y el catálogo de 30 productos. Para otro almacén:

```js
const almacen = KbitEngine.createInstance({
  layout: { levels: 2 },          // cualquier campo del plano; el resto toma el valor por defecto
  products: undefined,            // opcional: otro catálogo (ver «Productos»)
  groups: undefined               // opcional: nombres de las familias
});
almacen.slotName(1);              // "A01-2"
almacen.optimize(inicial, pedidos, reglas);
```

Cada instancia expone las mismas funciones que `KbitEngine`. Nunca mezcles índices de posición de dos instancias distintas.

## Plano (`layout`)

| Campo | Por defecto | Significado |
|---|---|---|
| `version` | `1` | Versión del contrato del plano. |
| `aisles` | `['A','B','C','D']` | Nombres de los pasillos, de izquierda a derecha. Únicos. |
| `bays` | `8` | Posiciones a lo largo de cada pasillo (fila 1 = junto al pasillo transversal delantero). |
| `levels` | `1` | Niveles de estante (pisos). `2` agrega un piso sobre cada posición. |
| `aisleSpacing` | `4` | Distancia entre pasillos contiguos, en unidades del plano. |
| `levelCost` | `1` | Distancia añadida por cada nivel de diferencia de altura. `0` = la altura no cuesta. |
| `reserved` | `['D08']` | Posiciones reservadas para movimientos temporales. No reciben productos en la propuesta. Si cambias `aisles` o `bays`, revisa que existan. |

`KbitEngine.createLayout(spec)` valida el plano y devuelve `slots`, `slotCount`, `distances`, `reserved`, `assignable`, `slotName(i)`, `slotIndex(nombre)` y `spec` (el plano normalizado, serializable a JSON).

### Numeración y nombres

- Índice de posición = `(pasillo × bays + posición) × levels + nivel`, todo desde 0.
- Con un nivel se conserva la numeración histórica: `A01` = 0 … `D08` = 31. Los estados guardados en el navegador siguen siendo válidos.
- Con más de un nivel el nombre lleva sufijo: `A01-1` (piso), `A01-2` (segundo nivel). Un nombre sin sufijo en `reserved` o en una zona significa el nivel 1 (`'D08'` → `'D08-1'`).

### Distancia

Entre dos posiciones del mismo pasillo: diferencia de filas. Entre pasillos distintos: `|Δpasillo| × aisleSpacing` más el recorrido hasta el pasillo transversal más cercano (delantero o trasero). A eso se suma `levelCost × |Δnivel|`. La matriz es simétrica y con ceros en la diagonal.

El **índice** que se optimiza es `Σ (veces que dos productos aparecen juntos en un pedido) × distancia entre sus posiciones`, sobre cada par de productos una vez.

## Productos (`products`, `groups`)

Cada producto es `{ id, code, name, family, category }`. Los `id` van de `0` a `n − 1` en orden; `family` es el índice de su familia en `groups`. Debe haber al menos tantas posiciones asignables como productos. La importación CSV reconoce los `code` del catálogo de la instancia.

## Distribución y pedidos

- Una distribución es un arreglo `assignment[idProducto] = índiceDePosición`, sin repetir posiciones.
- Un pedido es `{ id, items: [idProducto, …] }`.

## Reglas (`rules`)

```js
{
  maxMoves: 6,             // máximo de productos cuya posición final cambia (sin límite si se omite)
  pinned: [10],            // productos que no se mueven
  zones: [                 // opcional; ver abajo
    { id: 'limpieza', label: 'Limpieza en pasillo D', families: [2], aisles: ['D'] },
    { id: 'pesados',  label: 'Pesados abajo',        families: [5], levels: [1] }
  ],
  cleaningZone: true       // compatibilidad: se usa solo si no hay "zones"
}
```

**Zona**: los productos que coinciden (`families` o `products`) deben quedar en una posición que cumpla **todos** los filtros que la zona declare: `aisles` (nombres de pasillo), `levels` (desde 1) y `slots` (nombres de posición). Si un producto entra en varias zonas, debe cumplirlas todas. Las zonas no son exclusivas: otros productos pueden ocupar esas posiciones.

**Compatibilidad**: si `zones` no existe, `cleaningZone: true` equivale a `KbitEngine.CLEANING_ZONE` (familia 2 en el pasillo D). Cuando la interfaz guarde `zones`, ese arreglo manda y `cleaningZone` se ignora.

Un pasillo, nivel o posición que no existe en el plano produce un error con el nombre de la zona. `valid(distribución, inicial, reglas)` comprueba todo: posiciones asignables, sin repetir, zonas, productos fijos y máximo de movimientos. `zones(reglas)` devuelve las zonas efectivas.

## Plan (resultado de `optimize`)

| Campo | Significado |
|---|---|
| `initial`, `target` | Distribución de partida y propuesta. |
| `before`, `after`, `improvement` | Índice antes, después y mejora en %. |
| `moved` | Productos cuya posición final cambia. |
| `tasks` | Movimientos en orden: `{ id, product, from, to, temporary, done }`. Un ciclo usa una posición libre, primero las reservadas y dentro de la zona del producto si se puede. |
| `rules`, `history` | Copia de las reglas y evolución del índice. |
| `solver` | Método usado y su registro: `id`, `label`, `evaluations`, `milliseconds`. |

## Cálculo

| Función | Uso |
|---|---|
| `optimize(inicial, pedidos, reglas, opciones)` | Calcula el plan de forma síncrona. Para pruebas, scripts y Node. |
| `solveAsync(inicial, pedidos, reglas, { onProgress, signal, ...opciones })` | Promesa con el mismo plan, calculado en un Web Worker creado desde el propio motor (funciona también abriendo el HTML como archivo). Sin Worker, calcula en tramos de 25 ms sobre la página. `signal` (AbortController) cancela y rechaza con un error `AbortError`. |
| `createSolver(inicial, pedidos, reglas, opciones)` | Solver por tramos: `step(ms)` devuelve el estado y `result()` el plan cuando `done` es verdadero. |
| `deltaMove(distribución, flujos, producto, posición)` y `deltaSwap(distribución, flujos, a, b)` | Cambio del índice al mover a una posición vacía o intercambiar dos productos, en O(n). |

El estado de progreso es `{ done, phase, progress (0–1), before, best, evaluations, elapsed }`. La interfaz no debe llamar a `optimize` en la página para cálculos que el usuario espera: usa `solveAsync`.

## Qué cambiar en la interfaz para otro plano

El motor ya acepta otros planos; estas partes de la interfaz todavía asumen 4 × 8 × 1:

- `dist/app.js:11`: valida estados guardados con 30 productos.
- `dist/app.js:21`, `:37` y `:43`: textos con 30 productos, 4 pasillos y 32 posiciones.
- `dist/app.js:23-24`: el plano 2D usa `Array(32)`, `'ABCD'`, 8 filas y `slot===31` para la reserva. Usa `layout.slots`, `layout.reserved` y `slotName`.
- `dist/app.js:85`: la ficha de posición libre compara con `31`.
- `src/warehouse3d.js:45`: `position(slot)` calcula pasillo y fila con 8 posiciones. Para niveles, usa `layout.slots[slot].level` en la altura.
- `src/warehouse3d.js:48-65`: dibuja 4 pasillos, 8 posiciones y 9 montantes por lado.
- La casilla «Mantener limpieza en pasillo D» escribe `cleaningZone`. Para hacerla configurable, guarda `rules.zones`.
