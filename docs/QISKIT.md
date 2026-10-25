# Servicio de cálculo, QAOA y hardware de IBM

El servicio en Python es opcional. Sin él, la app calcula en el navegador como siempre. Con él, «Preparar turno» ofrece dos motores más: **Servidor · clásico** y **Servidor · QAOA**. El QAOA puede correr sobre:
- simuladores ideales;
- equipos de IBM simulados con su ruido;
- hardware real de IBM.

## Arrancar

Necesita Python 3.13+ y Node.js (el servicio usa el mismo motor que el navegador).

```bash
python -m venv .venv
.venv/bin/pip install -r server/requirements.txt
.venv/bin/python -m server                                   # http://127.0.0.1:8000
.venv/bin/python -m server.diagnose --device fake_torino     # punto 12: tamaño de bloque que resiste el ruido
.venv/bin/python -m server.benchmark                         # punto 19: resultados en results/benchmark.{json,md}
.venv/bin/python -m unittest discover -s server/tests -t .   # pruebas del servicio (no contactan a IBM)
```

Abre `http://127.0.0.1:8000`: el servicio también sirve la app y se conecta solo. Si abres `dist/Kbit-Slot.html` como archivo, pulsa «Conectar» bajo «Motor de cálculo». La app no consulta el servicio sin que lo pidas, para no llenar la consola de errores cuando no está activo. Con `npm start`, la app lo busca en `http://127.0.0.1:8000`.

| Variable | Por defecto | Uso |
|---|---|---|
| `KBIT_HOST`, `KBIT_PORT` | `127.0.0.1`, `8000` | Dirección del servicio. |
| `KBIT_NODE` | `node` del `PATH` | Ruta de Node.js. |
| `KBIT_ALLOWED_ORIGINS` | `null,http://127.0.0.1:4173,http://localhost:4173` | Orígenes con permiso CORS. `null` es la app abierta como archivo. |
| `KBIT_API_KEY` | — | Clave del servicio. Sin ella no se aceptan trabajos en hardware. |
| `QISKIT_IBM_TOKEN`, `QISKIT_IBM_INSTANCE` | — | API key y CRN de IBM Quantum. Si faltan, se usa la cuenta guardada con `QiskitRuntimeService.save_account()`. |
| `KBIT_IBM_CHANNEL` | `ibm_quantum_platform` | Canal de IBM Quantum. |
| `KBIT_IBM_LOCAL` | — | `1` agrega `ibm:fake_*`: el mismo flujo de hardware, ejecutado en el simulador local del equipo. |
| `KBIT_IBM_ACCOUNT` | — | `0` ignora la cuenta de IBM. Las pruebas lo usan para no contactar a IBM. |

**Seguridad:** el servicio escucha solo en `127.0.0.1`.
- Los simuladores no tienen autenticación: cualquier página local, incluida una con origen `null`, puede lanzar cálculos, y eso solo consume CPU.
- El hardware exige la cabecera `X-Kbit-Key` con el valor de `KBIT_API_KEY`, porque consume la cuota de QPU de la cuenta.
- El token de IBM nunca sale del servidor.
- En la app, la clave del servicio se guarda solo en `sessionStorage`.

## Arquitectura

| Pieza | Función |
|---|---|
| `server/app.py` | API FastAPI con cola de trabajos (uno a la vez), progreso, cancelación y autorización de hardware. También sirve `dist/`. |
| `server/bridge.cjs` y `server/engine.py` | Ejecutan `dist/engine.js`: reglas, índice, solver clásico, datos de demo y validación final del plan. Python no duplica reglas. |
| `server/quantum/qubo.py` | Modelo cuadrático, penalización desbalanceada y circuito LR-QAOA. |
| `server/quantum/swap_qaoa.py` | Codificación por intercambios (punto 9). |
| `server/quantum/window_qaoa.py` | Codificación por ventanas con corrección Húngara (punto 10). |
| `server/quantum/hybrid.py` | Búsqueda por bloques común a ambas codificaciones, con muestreo QAOA, aleatorio o exacto. |
| `server/quantum/backends.py` | Simuladores ideales (punto 11) y equipos simulados con ruido (punto 12). |
| `server/quantum/ibm.py` | Hardware de IBM (punto 13). |
| `server/diagnose.py`, `server/benchmark.py` | Diagnóstico de hardware (12) y benchmark reproducible (19). |
| `dist/remote.js` | Cliente. Cada plan del servidor se valida otra vez en el navegador con `planFrom`. |

## API

| Método y ruta | Uso |
|---|---|
| `GET /api/health` | Estado, versiones (Python, Qiskit, Aer, Node), motores, ejecutores y `hardware: { account, keyConfigured }`. |
| `GET /api/backends` | Ejecutores (`kind`: `ideal`, `noisy` o `ibm`) con su límite de qubits. |
| `POST /api/solve` | Crea un trabajo y responde `202`. En hardware requiere la cabecera `X-Kbit-Key`; sin ella responde `401`, y si el servidor no tiene clave, `403`. |
| `GET /api/jobs/{id}` | Estado: `queued`, `running`, `done`, `failed` o `cancelled`. Durante el progreso informa la fase (`inicio`, `qaoa`, `control`, `ibm`, `validacion`). Cuando termina, incluye el plan. |
| `DELETE /api/jobs/{id}` | Cancela el trabajo, y también el trabajo en IBM si lo hay. |

```json
{
  "spec": { "layout": { "levels": 1 } },
  "initial": [ … ], "orders": [ { "id": "PED-1", "items": [0, 5] } ],
  "rules": { "maxMoves": 8, "pinned": [10], "cleaningZone": true },
  "solver": "qaoa",
  "options": { "backend": "aer_statevector", "encoding": "swaps", "qubits": 12 }
}
```

`spec`, `initial`, `orders` y `rules` siguen `docs/CONTRATO-MOTOR.md`. Con `"solver": "clasico"`, `options` son las del motor (`seed`, `iterations`, …) y el resultado es idéntico al del navegador con la misma semilla.

## Simuladores ideales (punto 11)

| `backend` | Método | Exacto | Límite en esta máquina (15 GB) |
|---|---|---|---|
| `statevector` | `StatevectorSampler` de Qiskit | Sí | 22 qubits (lento desde ~20) |
| `aer_statevector` | Aer, statevector | Sí | Según la memoria libre: 16 · 2^q bytes, hasta el 60 % de la libre (≈ 26) |
| `aer_mps` | Aer, producto de matrices (MPS) | Solo si la dimensión de enlace ≥ 2^(q/2) | 64 |
| `aer_gpu` | Aer en GPU | Sí | Aparece solo si Aer detecta una GPU |

Tiempos por bloque, medidos con circuitos densos como los de este problema (p = 2, 1024 muestras):

| Caso | Tiempo por bloque |
|---|---|
| Statevector, 24 qubits | ≈ 8 s |
| Statevector, 26 qubits | ≈ 34 s |
| MPS, enlace 16, 30 qubits | ≈ 0,6 s (aproximado) |
| MPS, enlace 64, 24 qubits | ≈ 62 s |

Aer no informa si MPS truncó, así que esas corridas se marcan como aproximadas (`exact: false`). Más qubits también necesitan un almacén más grande: en la demo de un nivel caben 15 pares de intercambio como máximo, y con dos niveles, 29.

## Equipos con ruido y diagnóstico de hardware (punto 12)

`fake_torino` (Heron r1), `fake_fez` (Heron r2) y `fake_sherbrooke` (Eagle) son instantáneas calibradas que trae `qiskit-ibm-runtime`. Cada circuito se transpila a las puertas y conexiones del equipo (ISA) y se muestrea con su modelo de ruido. Cada bloque reporta:
- profundidad;
- puertas de dos qubits en el chip;
- **ESP**: el producto de (1 − error) sobre todas sus operaciones, una estimación rápida de fidelidad.

`python -m server.diagnose` mide la **tasa de acierto**: la fracción de muestras que, decodificadas, dan el óptimo del bloque. La compara en tres casos: ideal, con el ruido del equipo y al azar. Una configuración es útil en hardware solo si con ruido acierta al menos el doble que el azar. Resultados con la demo (12 movimientos, 3 bloques por configuración), en `results/diagnostico-fake_torino.json` y `results/diagnostico-fake_fez.json`:

| Intercambios | p | 2q en el chip (Torino / Fez) | ESP (Torino / Fez) | Aciertos ideal · ruido Torino · azar | Veredicto |
|---|---|---|---|---|---|
| 6 | 2 | 105 / 111 | 0,50 / 0,66 | 0,134 · 0,087 · 0,021 | útil |
| 8 | 1 | 92 / 89 | 0,59 / 0,71 | 0,090 · 0,074 · 0,011 | útil (6,7× el azar) |
| 8 | 2 | 208 / 188 | 0,36 / 0,51 | 0,071 · 0,061 · 0,011 | útil |
| 10 | 2 | 342 / 330 | 0,19 / 0,31 | 0,079 · 0,032 · 0,009 | útil (3,6×) |
| 10 | 4 | 677 / 677 | 0,04 / 0,10 | 0,070 · 0,021 · 0,009 | útil apenas |
| 12 | 1–4 | 241–862 / 237–987 | 0,27–0,02 / 0,42–0,03 | ≤ 0,039 · ≤ 0,022 · 0,015 | el ruido borra la señal |

- **Hasta 10 intercambios con p ≤ 2 hay señal en hardware.** Desde 12 qubits, el ruido de estos equipos la borra con cualquier número de capas.
- **La configuración de simulación ideal (12 qubits, p = 4) no sirve en hardware:** son unas 900 puertas de dos qubits y un ESP de 2 %. Por eso, en hardware, los valores por defecto pasan a 8 intercambios, p = 2 y 4 bloques por trabajo.
- **Las ventanas nunca son útiles en hardware**, ni siquiera de 2 productos. La reparación Húngara convierte muestras al azar en buenas asignaciones (el azar acierta el 44 % con ventanas de 2 y el 12 % con ventanas de 3), así que el circuito apenas aporta incluso sin ruido.

## Híbrido QAOA: intercambios y ventanas (puntos 9 y 10)

En cada ronda se construyen `blocksPerRound` bloques a partir del plan actual y se muestrean juntos (en hardware, un solo trabajo). Cada muestra se decodifica en un plan válido con el índice real, y el mejor resultado reemplaza al plan si mejora.

**Intercambios** (`encoding: swaps`, por defecto). Un qubit por par disjunto de productos movibles o posiciones libres. El índice tras cualquier combinación de intercambios es un polinomio cuadrático exacto, obtenido con 1 + k + k(k−1)/2 evaluaciones. Las reglas de Kbit se aplican así:
- Los productos fijos no entran en ningún par.
- Un par solo existe si respeta las zonas y las reservas.
- El límite de movimientos se maneja de tres formas: un precio sombra por cada reubicación extra al elegir los pares; la penalización desbalanceada −λ1·h + λ2·h² dentro del circuito, sin qubits extra (Montañez-Barrera et al., arXiv:2211.13914); y la reparación de las muestras que se pasan.

**Ventanas** (`encoding: window`, adaptado de la demo QAOA-LNS). Unos pocos productos y sus posiciones, más una libre, con un qubit por cada par (producto, posición) permitido. Las zonas y reservas eliminan qubits en lugar de penalizarlos. Expresa cadenas de 3 o más productos que los intercambios no pueden.
- Elección de productos: una semilla ponderada por su peso en el índice, los productos que se piden con ella y los que están junto a sus compañeros de pedido.
- En el límite de movimientos se priorizan los productos ya reubicados.
- "Cada producto una vez" y "cada posición a lo sumo una vez" entran como penalizaciones.
- Las muestras inválidas se corrigen con el algoritmo Húngaro.
- Con p = 4, el 35 % de la probabilidad cae en asignaciones válidas (50 veces el azar). Con p = 2 no alcanza.

**Mixta** (`encoding: mixed`): alterna bloques de intercambios y de ventanas.

**Muestreo** (`sampling`), para medir qué aporta el circuito:
- `qaoa`: el circuito.
- `uniform`: las mismas muestras tomadas al azar, con generador propio para que la elección de bloques no cambie.
- `exact`: el bloque resuelto por enumeración clásica.

| Opción | Por defecto (hardware) | Uso |
|---|---|---|
| `encoding`, `sampling` | `swaps`, `qaoa` | Codificación y muestreo. |
| `qubits` | 12 (8) | Pares por bloque de intercambios. Entre paréntesis, los valores para equipos con ruido y hardware. |
| `window`, `freeSlots` | 3, 1 | Productos y posiciones libres por ventana. |
| `layers`, `deltaBeta`, `deltaGamma` | 4 (2), 0.75, 1.5 | Capas y pendientes de las rampas. |
| `shots`, `blocks`, `blocksPerRound`, `seconds` | 1024, 24 (12), 1 (4), 60 | Muestras, bloques, bloques por trabajo y tope de tiempo. |
| `backend`, `bondDimension`, `optimizationLevel` | `aer_statevector`, 16, 2 | Ejecutor, enlace MPS y nivel de transpilación. |
| `maxQuantumSeconds` | 60 | Tope de segundos de QPU por cálculo en hardware. |
| `start` | `none` | Inicio: `none` (distribución actual), `greedy` o `annealing`. |
| `seed`, `temperature`, `shadowPrice`, `penalty`, `oneHotPenalty`, `referenceQubits` | 7, 0.5, `true`, `[0.5, 0.1]`, 1, 18 | Detalles del método. |

En `plan.solver` llegan:
- **Configuración:** `encoding`, `sampling`, `qubits`, `layers`, `shots`.
- **Bloques:** `blocks`, `rounds`, `acceptedBlocks`, `startCost`, `qiskitGain`, `feasibleShots`, `repairedBlocks`, `optimumHitRate`.
- **Circuito y chip:** `maxTwoQubitGates`, `maxIsaTwoQubitGates`, `minEsp`, `noisy`, `exact`.
- **Hardware:** `jobs` (identificadores de trabajos de IBM) y `quantumSeconds`.
- **Registro:** `log`, una entrada por bloque.

## Hardware de IBM (punto 13)

1. Configura la cuenta con `QISKIT_IBM_TOKEN` y `QISKIT_IBM_INSTANCE`, o guárdala una vez con `QiskitRuntimeService.save_account(...)`. Esta máquina ya tiene una cuenta guardada (instancia `open-instance`, plan Open).
2. Define una clave del servicio, por ejemplo `export KBIT_API_KEY=$(openssl rand -hex 16)`, y arranca `python -m server`.
3. En la app, elige **Servidor · QAOA**, un equipo **IBM · … (hardware)**, y pega la clave.

Qué ocurre:
- Los equipos operativos de la cuenta se listan en caché por cinco minutos.
- Cada ronda transpila sus circuitos a la ISA del equipo y los envía en un solo trabajo, dentro de un `Batch`, con el Sampler del cliente (`qiskit_ibm_runtime.executor_sampler`).
- Mitigación: desacople dinámico XY4 y *twirling* de puertas y mediciones. Con *twirling*, las muestras se reparten en aleatorizaciones y un trabajo puede devolver algunas más.
- La app muestra el estado del trabajo en la cola de IBM. Cancelar el cálculo cancela también el trabajo en IBM.
- Los segundos de QPU de cada trabajo se suman, y el cálculo se detiene en `maxQuantumSeconds` (60 s). El plan informa los identificadores de trabajo y el tiempo usado.

`KBIT_IBM_LOCAL=1` recorre exactamente el mismo flujo con `ibm:fake_torino` en el simulador local, y así lo prueban `server/tests/test_ibm.py`. **Este flujo no se ha ejecutado todavía en hardware real.** Hacerlo consume cuota del plan Open y queda a tu decisión.

## Benchmark reproducible (punto 19)

`python -m server.benchmark` corre 5 escenarios (demo con 8, 12 y sin límite de movimientos, otro historial de pedidos y un almacén de dos niveles) con 3 semillas, siempre desde la distribución actual. Corre estos métodos:
- búsqueda voraz y recocido del navegador;
- QAOA por intercambios y por ventanas, cada uno con sus controles aleatorio y exacto;
- con `--noisy fake_torino`, la configuración de hardware sobre ruido simulado.

Cada plan se valida con `planFrom`. Se guardan todas las corridas, junto con las versiones, el commit, las opciones y los tiempos, en `results/benchmark.json`, y un resumen en `results/benchmark.md`.

### Resultados

Commit `1c7331b`, 3 semillas, 135 corridas, todas válidas. Ese commit se reubicó como `1068f32` al integrar `24d8fb8`, que solo cambia el diseñador; el código del motor y del servidor es el mismo. Índice final medio (menor es mejor); detalle completo en `results/benchmark.md`.

| Método | demo-8 | demo-12 | demo sin límite | pedidos B, 12 | dos niveles, 12 | Tiempo |
|---|---|---|---|---|---|---|
| Búsqueda voraz | 3256 | 3059 | 2722 | 3715 | 2627 | < 0,1 s |
| **Recocido (navegador)** | **3105** | **2628** | **2318** | **3680** | **2160** | 0,2 s |
| QAOA · intercambios | 3232 | 2874 | 2692 | 3751 | 2230 | 2,4 s |
| Azar · intercambios | 3232 | 2870 | 2682 | 3751 | 2266 | 0,5 s |
| Exacto · intercambios | 3232 | 2926 | 2693 | 3804 | 2229 | 0,2 s |
| QAOA · ventanas | 3775 | 3631 | 3330 | 4580 | 3220 | 2,5 s |
| QAOA con ruido de Torino (8 qubits, p = 2) | 3219 | 2788 | 2645 | 3814 | 2552 | 16 s |

| Comparación con la misma semilla | Gana | Empata | Pierde |
|---|---|---|---|
| QAOA · intercambios frente a azar | 5 | 8 | 2 |
| QAOA · intercambios frente a exacto | 3 | 11 | 1 |
| QAOA · ventanas frente a azar | 1 | 14 | 0 |
| QAOA · intercambios frente a recocido | 0 | 0 | 15 |

Lectura:
1. **El recocido clásico gana las 15 corridas** al QAOA, y es unas 10 veces más rápido.
2. **El circuito aporta poco sobre el azar.** Con el mismo procedimiento, las muestras uniformes empatan 8 de 15 veces, y QAOA gana 5 y pierde 2. La mejora del híbrido viene sobre todo de la búsqueda por bloques y de la decisión clásica: evaluar el índice real y reparar.
3. **Resolver cada bloque de forma exacta no es mejor** (2926 frente a 2874 en `demo-12`). Tomar siempre el óptimo del bloque estanca la búsqueda antes; muestrear da variedad.
4. **Ventanas:** QAOA y azar empatan 14 de 15 veces, y quedan por detrás de los intercambios.
5. **La configuración de hardware con ruido** rinde como la ideal en la demo (2788 y 2645 frente a 2874 y 2692), gracias a sus 4 bloques por trabajo, pero peor con dos niveles (2552 frente a 2230). El ruido no impide que el procedimiento funcione, y eso tampoco prueba que el circuito ayude (punto 2).
6. **Con otro historial de pedidos** (`pedidos-b-12`), el híbrido no mejora a la búsqueda voraz (3751 frente a 3715).

Conclusión: a esta escala no hay ventaja cuántica. El valor actual es una plataforma de experimentación honesta: los mismos bloques con circuito, con azar y con solución exacta, y el camino completo hasta hardware real.

## Hallazgo: signo del mezclador en `demo-almacen`

`../demo/demo-almacen/swap_qaoa.py` aplica el mezclador `rx(+2β)` sobre |+⟩. Con rampas fijas, eso sigue los estados de **mayor** energía. Medido en un bloque de 10 qubits:

| Mezclador | Energía esperada | P(óptimo) | Masa en el 1 % mejor |
|---|---|---|---|
| `rx(+2β)` | 4327 (peor que el promedio uniforme, 4034) | 0 | 0 % |
| `rx(−2β)` | 3812 | 3 % (30 veces el azar) | 25 % |

Aquí se usa `rx(−2β)`, y una prueba verifica que el circuito concentra probabilidad en energías bajas. El benchmark de `demo-almacen`, donde Qiskit empata con los clásicos, probablemente está afectado por este error.
