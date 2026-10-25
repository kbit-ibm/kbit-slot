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
| `solver` | Método y registro: `id` (`voraz+recocido` o `voraz`), `label`, `seed`, `iterations`, `evaluations`, `milliseconds`, `greedy` (índice de la búsqueda voraz) y `timeLimited`. |

## Cálculo

| Función | Uso |
|---|---|
| `optimize(inicial, pedidos, reglas, opciones)` | Calcula el plan de forma síncrona. Para pruebas, scripts y Node. |
| `solveAsync(inicial, pedidos, reglas, { onProgress, signal, ...opciones })` | Promesa con el mismo plan, calculado en un Web Worker creado desde el propio motor (funciona también abriendo el HTML como archivo). Sin Worker, calcula en tramos de 25 ms sobre la página. `signal` (AbortController) cancela y rechaza con un error `AbortError`. |
| `createSolver(inicial, pedidos, reglas, opciones)` | Solver por tramos: `step(ms)` devuelve el estado y `result()` el plan cuando `done` es verdadero. |
| `deltaMove(distribución, flujos, producto, posición)` y `deltaSwap(distribución, flujos, a, b)` | Cambio del índice al mover a una posición vacía o intercambiar dos productos, en O(n). |
| `describe(inicial, pedidos, reglas)` | El problema en JSON para solvers externos: distancias, flujos, posiciones permitidas por producto, fijos y máximo de movimientos. |
| `planFrom(inicial, pedidos, reglas, propuesta, solver)` | Convierte una propuesta externa en plan. Rechaza la que no cumpla las reglas y recalcula el índice. |

El servicio en Python (`server/`, ver `docs/QISKIT.md`) usa estas mismas funciones a través de `server/bridge.cjs`, y `dist/remote.js` valida en el navegador cada plan que recibe.

El estado de progreso es `{ done, phase, progress (0–1), before, best, evaluations, iteration, elapsed }`. `phase` pasa por `voraz` → `recocido` → `pulido` → `listo`. La interfaz no debe llamar a `optimize` en la página para cálculos que el usuario espera: usa `solveAsync`.

### Método y opciones

1. **Búsqueda voraz** (el método histórico): aplica en cada ronda el mejor movimiento o intercambio que cumple las reglas, hasta que ninguno mejora.
2. **Recocido simulado**: `restarts` cadenas independientes de `iterations` pasos, cada una desde el plan voraz. Los vecinos son: devolver un producto a su posición original, mover un producto ya reubicado o mover cualquier producto (intercambio si la posición está ocupada). La temperatura inicial se calibra con el empeoramiento medio de vecinos al azar, así que se adapta al volumen de pedidos.
3. **Pulido**: búsqueda voraz desde el mejor plan encontrado.

Todos los pasos respetan las reglas; el plan final se recalcula completo y se valida antes de devolverlo.

| Opción | Por defecto | Uso |
|---|---|---|
| `seed` | `1` | Semilla. Misma semilla e iteraciones ⇒ mismo plan, en la página y en el Worker. |
| `iterations` | `25000` | Pasos por cadena. `0` = solo búsqueda voraz (resultados del motor anterior). |
| `restarts` | `32` | Número de cadenas. |
| `timeLimit` | `5000` | Tope de seguridad en ms; si se alcanza, `solver.timeLimited` es verdadero y el plan sigue siendo válido. |
| `heat`, `chill` | `1`, `0.01` | Temperatura inicial (× empeoramiento medio) y temperatura final relativa. |
| `revertRate`, `movedRate` | `0.05`, `0.15` | Proporción de vecinos que devuelven un producto o mueven uno ya reubicado. |

Calibración (4 conjuntos de pedidos, 4 límites de movimientos, 3 semillas): brecha media de 0,05 % frente a referencias de corridas largas, en ~150 ms. En casos que no se usaron para calibrar, con 1 y 2 niveles: 0,13 % y 0,38 % (búsqueda voraz: 3 % y 11 %), nunca peor que la búsqueda voraz.

## Plano físico del diseño guardado

La variante rectangular anterior sigue disponible para el ejemplo heredado. La operación sobre el diseño guardado usa:

```js
const operation = KbitOperation.create(configuracionGuardada);
const motor = operation.engine;
const { assignment, orders } = operation.demo();
const plan = operation.decorate(await motor.solveAsync(assignment, orders, reglas));
const ruta = operation.route(plan.tasks[0].from, plan.tasks[0].to);
```

El contrato serializable es `{ kind:'physical', version:1, slots, distances, reserved }`. Cada slot incluye `name`, `aisleName`, `level` (desde cero), `x,y,z` y los metadatos del adaptador como `sector`. La matriz debe ser cuadrada, finita, no negativa, simétrica y con diagonal cero. Las direcciones no pueden repetirse y las reservas deben existir. El motor admite entre 2 y 128 slots físicos; el adaptador actual limita la muestra a 64.

El Worker y el puente remoto reconstruyen la misma instancia desde `motor.spec`; nunca deben sustituirla por el plano rectangular por defecto. `dist/remote.js` recibe la instancia activa mediante la opción `engine` y valida la propuesta con ella.

**Plano por pasillos (modo completo).** Para un diseño Paralelo completo, `KbitOperation.create(config, { mode: 'completa' })` entrega `{ kind:'corridors', aisles, corridors, crossings, levelCost, accessCost, slots, reserved }`. Cada slot es `{ name, aisle, z, level }`. La distancia entre dos ubicaciones distintas se calcula así:
- dentro de un pasillo, la diferencia de `z`;
- entre pasillos, la diferencia de `corridors[x]` más el mínimo sobre `crossings` de `|z₁ − c| + |z₂ − c|`;
- en ambos casos se suma `levelCost × |Δnivel| + accessCost`.

La matriz se calcula en el motor (`Float32Array`, 16 MB con 2.000 ubicaciones), así que no viaja en el JSON.

`decorate` añade `layoutKey` al plan y `fromSector/toSector` a cada tarea. `blocks` agrupa tareas consecutivas por sector de origen, manteniendo su orden y dependencias. Ver [operación sobre el diseño](warehouse-operation.md).
