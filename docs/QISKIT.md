# Servicio de cálculo, simuladores y QAOA

El servicio en Python es opcional. Sin él, la app calcula en el navegador como siempre. Con él, «Preparar turno» ofrece dos motores más: **Servidor · clásico** y **Servidor · QAOA simulado**.

## Arrancar

Necesita Python 3.13+ y Node.js (el servicio usa el mismo motor que el navegador).

```bash
python -m venv .venv
.venv/bin/pip install -r server/requirements.txt
.venv/bin/python -m server                                  # http://127.0.0.1:8000
.venv/bin/python -m unittest discover -s server/tests -t .  # pruebas del servicio
```

Abre `http://127.0.0.1:8000`: el servicio también sirve la app y se conecta sola. Si abres `dist/Kbit-Slot.html` como archivo, pulsa «Conectar» bajo «Motor de cálculo» (no consulta el servicio sin que lo pidas, para no llenar la consola de errores cuando no está activo). Con `npm start`, la app lo busca en `http://127.0.0.1:8000`.

| Variable | Por defecto | Uso |
|---|---|---|
| `KBIT_HOST`, `KBIT_PORT` | `127.0.0.1`, `8000` | Dirección del servicio. |
| `KBIT_NODE` | `node` del `PATH` | Ruta de Node.js. |
| `KBIT_ALLOWED_ORIGINS` | `null,http://127.0.0.1:4173,http://localhost:4173` | Orígenes con permiso CORS. `null` es la app abierta como archivo. |

**Seguridad:** el servicio escucha solo en `127.0.0.1` y no tiene autenticación. Por eso cualquier página local con origen `null` puede lanzar cálculos. Con simuladores eso solo consume CPU, pero antes de conectar hardware real de IBM hay que agregar autenticación. El token de IBM debe quedarse en el servidor.

## Arquitectura

| Pieza | Función |
|---|---|
| `server/app.py` | API FastAPI con cola de trabajos (uno a la vez), progreso y cancelación. También sirve `dist/`. |
| `server/bridge.cjs` | Ejecuta `dist/engine.js`: reglas, índice, solver clásico y validación final del plan. Python no duplica reglas. |
| `server/quantum/backends.py` | Simuladores (punto 11). |
| `server/quantum/swap_qaoa.py` | Híbrido QAOA con las reglas de Kbit (punto 9). |
| `dist/remote.js` | Cliente. Cada plan del servidor se valida otra vez en el navegador con `planFrom`. |

## API

| Método y ruta | Uso |
|---|---|
| `GET /api/health` | Estado, versiones (Python, Qiskit, Aer, Node), motores y simuladores. |
| `GET /api/backends` | Simuladores con su límite de qubits en esta máquina. |
| `POST /api/solve` | Crea un trabajo y responde `202` con `{ id, status, progress }`. |
| `GET /api/jobs/{id}` | Estado: `queued`, `running`, `done`, `failed` o `cancelled`. Cuando termina, incluye el plan en `result` y el error en `error`. |
| `DELETE /api/jobs/{id}` | Cancela el trabajo. |

```json
{
  "spec": { "layout": { "levels": 1 } },
  "initial": [ … ], "orders": [ { "id": "PED-1", "items": [0, 5] } ],
  "rules": { "maxMoves": 8, "pinned": [10], "cleaningZone": true },
  "solver": "qaoa",
  "options": { "backend": "aer_statevector", "qubits": 12 }
}
```

`spec`, `initial`, `orders` y `rules` siguen `docs/CONTRATO-MOTOR.md`. Con `"solver": "clasico"`, `options` son las del motor (`seed`, `iterations`, …) y el resultado es idéntico al del navegador con la misma semilla.

## Simuladores (punto 11)

| `backend` | Método | Exacto | Límite en esta máquina (15 GB) |
|---|---|---|---|
| `statevector` | `StatevectorSampler` de Qiskit | Sí | 22 qubits (lento desde ~20) |
| `aer_statevector` | Aer, statevector | Sí | Según la memoria libre: 16 · 2^q bytes, hasta el 60 % de la libre (≈ 26) |
| `aer_mps` | Aer, producto de matrices (MPS) | Solo si la dimensión de enlace ≥ 2^(q/2) | 64 |
| `aer_gpu` | Aer en GPU | Sí | Aparece solo si Aer detecta una GPU |

Tiempos medidos con circuitos densos como los de este problema (p = 2, 1024 muestras):

| Caso | Tiempo |
|---|---|
| Statevector, 24 qubits | ≈ 8 s por bloque |
| Statevector, 26 qubits | ≈ 34 s por bloque |
| MPS, enlace 16, 30 qubits | ≈ 0,6 s por bloque (aproximado) |
| MPS, enlace 64, 24 qubits | ≈ 62 s por bloque |

Aer no informa si MPS truncó, así que esas corridas se marcan como aproximadas (`exact: false`). El enlace por defecto es 16 (`bondDimension`).

Más qubits también necesitan un almacén más grande. Cada qubit es un par disjunto que incluye al menos un producto movible. En la demo de un nivel (29 productos movibles y 1 posición libre) caben 15 pares como máximo. Con dos niveles, hasta 29.

## Híbrido QAOA por intercambios (punto 9)

1. **Inicio** (`start`): `none` (distribución actual, por defecto), `greedy` o `annealing`.
2. **Bloque**: elige hasta `qubits` pares disjuntos de productos movibles o posiciones libres. Cada par solo existe si cada producto puede ocupar la posición del otro (zonas y reservas); los productos fijos nunca entran. Cerca del límite de movimientos, cada reubicación extra lleva un precio sombra, así el bloque mezcla movimientos nuevos y reversiones.
3. **Modelo**: el índice tras cualquier combinación de intercambios es un polinomio cuadrático exacto, que se obtiene con 1 + k + k(k−1)/2 evaluaciones (nunca 2^k).
4. **Circuito**: LR-QAOA con rampas lineales fijas, sin entrenar ángulos. El límite de movimientos (Σ c·z ≤ holgura) entra como penalización desbalanceada −λ1·h + λ2·h², sin qubits extra (Montañez-Barrera et al., arXiv:2211.13914).
5. **Decisión**: se evalúan las muestras con el índice real. Las que exceden el límite se reparan apagando primero los intercambios más baratos de deshacer. El mejor plan se valida y reemplaza al actual solo si mejora.
6. **Plan**: lo construye `planFrom` en el servidor y otra vez en el navegador. La app muestra al lado la referencia clásica.

| Opción | Por defecto | Uso |
|---|---|---|
| `qubits` | 12 | Pares por bloque. |
| `layers`, `deltaBeta`, `deltaGamma` | 4, 0.75, 1.5 | Capas y pendientes de las rampas (calibradas: 46 % de la probabilidad en el 1 % mejor de cada bloque). |
| `shots`, `blocks`, `seconds` | 1024, 24, 60 | Muestras por bloque, bloques y tope de tiempo. |
| `backend`, `bondDimension` | `aer_statevector`, 16 | Simulador y enlace MPS. |
| `seed`, `temperature` | 7, 0.5 | Semilla y ruido en la elección de pares. |
| `shadowPrice`, `penalty` | `true`, `[0.5, 0.1]` | Manejo del límite de movimientos. `penalty: null` lo desactiva. |
| `referenceQubits` | 18 | Hasta ese tamaño, cada bloque se resuelve también por enumeración para medir si QAOA encontró su óptimo. |

En `plan.solver` llegan: `qubits`, `layers`, `shots`, `blocks`, `acceptedBlocks`, `startCost`, `qiskitGain` (mejora sobre el inicio), `feasibleShots`, `repairedBlocks`, `optimumHitRate`, `maxDepth`, `maxTwoQubitGates`, `exact`, `sampleSeconds`, `milliseconds` y `log` (un registro por bloque).

### Resultados medidos

Demo de 30 SKUs, Aer statevector, 12 qubits, 24 bloques y 3 semillas, partiendo de la distribución actual:

| Máx. movimientos | Búsqueda voraz | Recocido (navegador) | Híbrido QAOA (media) | Óptimo del bloque encontrado | Muestras factibles |
|---|---|---|---|---|---|
| 8 | 3256 | **3122** | 3232 | 100 % | 15 % |
| 12 | 3059 | **2628** | 2755 | 100 % | 71 % |
| sin límite | 2722 | **2316** | 2692 | 100 % | 100 % |

- El híbrido supera a la búsqueda voraz, pero no al recocido clásico. No hay ventaja cuántica a esta escala, y la app lo muestra con la «Referencia clásica».
- Desde un plan voraz que ya agotó el límite de movimientos, los bloques casi nunca mejoran. Todo cambio que mejora por sí solo excede el límite, y las mejoras restantes requieren cadenas de 3 o más productos, que los intercambios disjuntos no expresan.
- Sin la penalización, solo el 0–5 % de las muestras respeta el límite y la reparación clásica hace el trabajo. Con ella, QAOA muestrea planes factibles por sí mismo.

### Hallazgo: signo del mezclador en `demo-almacen`

`../demo/demo-almacen/swap_qaoa.py` aplica el mezclador `rx(+2β)` sobre |+⟩. Con rampas fijas, eso sigue los estados de **mayor** energía. Medido en un bloque de 10 qubits:

| Mezclador | Energía esperada | P(óptimo) | Masa en el 1 % mejor |
|---|---|---|---|
| `rx(+2β)` | 4327 (peor que el promedio uniforme, 4034) | 0 | 0 % |
| `rx(−2β)` | 3812 | 3 % (30 veces el azar) | 25 % |

Aquí se usa `rx(−2β)`, y una prueba verifica que el circuito concentra probabilidad en energías bajas. El benchmark de `demo-almacen`, donde Qiskit empata con los clásicos, probablemente está afectado por este error.
