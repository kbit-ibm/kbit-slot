# Operación sobre el almacén guardado

Guardar un diseño aplica su geometría a Mi almacén, Preparar turno, el plano, la animación y las tareas. Los cuatro tipos usan el mismo renderizador de estantes y las direcciones `Pxx-I/D-Exx-Nxx-Uxx`. Las cajas de operación representan productos de demostración, en lugar de la ocupación decorativa del diseñador.

## Un plan para visualizar y ejecutar

La primera simulación calcula y guarda un plan con el motor activo. Tareas presenta ese mismo plan, con sector y dirección completa de origen y destino. Los bloques agrupan movimientos consecutivos del mismo sector de origen; no se ordenan alfabéticamente si eso rompe las dependencias. Un traslado entre sectores muestra ambos y puede requerir volver a un sector anterior.

Solo el siguiente movimiento se puede confirmar. La confirmación actualiza la ubicación local y se conserva al recargar. Reproducir, pausar, acelerar o reiniciar la animación no confirma tareas. Si ya hay movimientos confirmados, la reproducción parte de la distribución actual y muestra los pendientes; un turno completado se puede volver a visualizar desde su distribución inicial.

## Circulación compartida

`operation-model.js` construye un grafo con centros de pasillos, cruces, accesos diagonales y conectores periféricos según la geometría. Las ubicaciones se conectan al centro de su pasillo. Dijkstra calcula los recorridos entre los nodos activos; la función de distancia añade el acceso al estante y la diferencia de altura. La animación sale del estante, recorre esas vías y entra en el destino.

El motor recibe esas distancias y direcciones mediante `kind: 'physical'`. El plano SVG y la escena 3D comparten el mismo modelo paramétrico. En almacenes grandes la escena general conserva la representación por sectores; seleccionar un producto permite explorar su sector.

Las uniones con la V se obtienen de sus coordenadas dibujadas, sin reconstruirlas desde las dimensiones del edificio. Fishbone incorpora también los cruces en los huecos entre módulos, limitados a cada zona. Dijkstra elige la menor distancia entre las vías de esa red; el reproductor muestra los metros recorridos en planta, sin sumar la bajada o subida de la caja. Es un criterio de distancia, sin velocidades de equipos ni congestión.

La corrección de las rutas conserva las direcciones, tareas y confirmaciones existentes. Al reproducir un plan guardado se usa la red actual. Un nuevo cálculo usa también sus distancias corregidas; las métricas archivadas de planes anteriores conservan la valoración de cuando se generaron.

## Datos y límites

- Hasta 30 productos y pedidos sintéticos del catálogo existente, colocados de forma reproducible en direcciones del diseño. Un almacén muy pequeño usa menos productos y conserva una ubicación libre.
- Hasta 64 ubicaciones candidatas repartidas por sectores. La matriz y el cálculo no abarcan toda la capacidad teórica del edificio.
- El diseño completo sigue visible. Mostrar cientos de miles de ubicaciones posibles no demuestra que se hayan optimizado esos inventarios.
- No hay importación de inventario real, cantidades, equipos, sentidos de circulación, tráfico ni restricciones de peso o seguridad. La importación CSV existente cambia pedidos del catálogo demo.
- Las rutas son una representación del modelo configurado, sin calibración física ni ejecución en un WMS.

## Modo completo (Paralelo)

En «Preparar turno» y «Tareas», el aviso del almacén permite cambiar entre **Muestra** y **Completa** cuando el diseño es Paralelo y tiene hasta 2.000 ubicaciones.

- **Muestra** (por defecto, las cuatro geometrías): lo descrito arriba. Hasta 64 ubicaciones repartidas por sectores y hasta 30 productos del catálogo existente.
- **Completa:** todas las ubicaciones del diseño y un catálogo de ejemplo a su escala, de aproximadamente el 30 % de las ubicaciones con un máximo de 150 SKUs. La limpieza queda en el piso del último pasillo.
  - El motor recibe `kind: 'corridors'`, la distancia del grafo de circulación en forma cerrada: diferencia a lo largo del pasillo, o desplazamiento entre pasillos más el cruce más corto (atrás, intermedios o frente), más el acceso a ambos estantes y la diferencia de altura.
  - En un Paralelo coincide con Dijkstra; las pruebas comparan ambos modos con una tolerancia de 10⁻⁴.
  - Las rutas de animación siguen calculándose con Dijkstra, pero solo para los movimientos del plan.
  - En un diseño de 1.728 ubicaciones con 150 SKUs, la operación se construye en unos 0,3 s y un plan de 6 a 12 movimientos tarda de 3 a 5 s en el Worker.
- Cada modo guarda su propia operación (`kbit-slot-operation:<huella>-completa` para el completo) y la elección se recuerda en `kbit-slot-operation-mode`.

Flying-V, Fishbone y Chevron siguen con la muestra: su circulación no se reduce a pasillos y cruces rectos.

## Persistencia por diseño

El diseño conserva su clave existente. La operación usa `kbit-slot-operation:<huella>`; la huella depende de geometría, cantidades y medidas. Renombrar el almacén conserva su operación. Cambiar su geometría o medidas abre otra operación, sin aplicar tareas antiguas a ubicaciones incompatibles. Volver a la misma configuración recupera sus confirmaciones. El ejemplo heredado conserva `kbit-slot-demo-v1` por separado.

Todo se guarda en `localStorage`, por navegador y origen. No se sincroniza entre colaboradores. Para pasar al producto industrial, la siguiente etapa es asociar inventario real y resolver subproblemas por sectores con un presupuesto de traslados; el uso cuántico requiere una evaluación separada.
