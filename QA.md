# Verificación de las cuatro geometrías

- `npm test`: 32 pruebas aprobadas (19 del motor existente y 13 del diseñador).
- Paralelo, Flying-V, Fishbone y Chevron tienen geometría física diferenciada en SVG y Three.js, con los mismos postes, bandejas, cajas, controles y selección.
- Cambiar de tipo conservó cantidades, niveles, huecos y medidas; la V y el ángulo solo aparecieron en los tipos correspondientes.
- Flying-V con 6 pasillos, 12 módulos máximos, 4 niveles y 3 huecos: 112 estantes / 1.344 ubicaciones. La V quedó libre de estantes.
- Fishbone con 6 filas por zona: selección del sector inferior izquierdo S09 y del estante horizontal P13-I-E01, con sus 12 ubicaciones y direcciones por nivel.
- Chevron: selección de P01-I-E01 y cambio a 60 grados; guardado, aparición en Mi almacén y recarga conservaron la geometría y el ángulo.
- Aumentar a 5 niveles y cambiar a tema oscuro conservó el borrador de 2.880 ubicaciones. Restaurar recuperó el diseño guardado.
- Móvil: 375 px de contenido y 375 px disponibles, sin desbordamiento horizontal; controles específicos visibles y utilizables.
- HTML independiente por HTTP: cambio de Fishbone a Chevron, plano 2D y selección directa de P01-I-E01 verificados, sin errores de JavaScript.
- No se encontraron IDs duplicados. Se actualizó la captura de `docs/designer.png` con Fishbone en 3D.
- Pruebas del modelo: cobertura de sectores, direcciones únicas, capacidad real, colisiones entre módulos, separación de circulación, recorte de tramos, ángulos extremos, filas en un solo lado y configuraciones máximas. El detalle mantiene un máximo de 80 módulos por sector.
- Los diseños anteriores se migran a Paralelo conservando medidas, capacidad y direcciones. No se modifica el valor guardado hasta pulsar Guardar diseño.

Las formas son modelos paramétricos ilustrativos. No se ha conectado el diseñador al motor ni se ha demostrado ahorro de recorridos. Las pruebas existentes del motor remoto/clásico se conservaron; no se ejecutó un backend cuántico durante esta tarea visual.

# Verificación previa del diseñador de almacenes

- `npm test`: 16 pruebas aprobadas (9 del motor existente y 7 del modelo de almacén).
- `npm run build`, `npm run export`, comprobación de sintaxis y `git diff --check` completados.
- Plantilla Distribución: 144 estantes; subir de 4 a 5 niveles actualizó la capacidad a 2.160 ubicaciones.
- Fulfillment: 1.200 estantes / 21.600 ubicaciones / 15 sectores. Entrada directa al sector S08 mediante clic en el modelo 3D.
- Selección de P09-I-E11: mostró 18 ubicaciones, desde P09-I-E11-N01-U01 hasta P09-I-E11-N06-U03.
- Vista completa → detalle de sector → plano 2D verificados.
- Configuración máxima: 921.600 ubicaciones / 160 sectores, con selector de estantes desactivado hasta entrar en un sector. No constituye una prueba del optimizador a esa escala.
- Cantidad inválida (65 pasillos) bloqueó el guardado y mostró un error de campo.
- Guardado de Centro de distribución Lima: apareció en Mi almacén y se conservó tras recargar.
- Acceso a la operación de ejemplo y a su plan existente, con aviso explícito del plano de 30 SKUs / 32 posiciones.
- Cambio a 7 niveles y tema oscuro: el borrador mantuvo 25.200 ubicaciones. Restaurar recuperó las 21.600 guardadas.
- Un solo lado redujo la capacidad de Fulfillment a 10.800 ubicaciones.
- Vista móvil: ancho de contenido y viewport coincidentes (360 px disponibles en la prueba), sin desbordamiento horizontal.
- HTML independiente verificado por HTTP: plantilla Estantería alta con 5.120 ubicaciones y plano 2D funcional.
- Sin IDs duplicados ni errores de JavaScript en las comprobaciones del navegador.

El plano 2D se comprobó como vista alternativa. La caída real del contexto WebGL no se forzó. El diseño admite una sola planta y no alimenta todavía el optimizador.

# Verificación previa de la operación visual 3D

- Las nueve pruebas del motor y del CSV pasaron.
- El HTML independiente se abrió por HTTP y mostró el almacén 3D sin archivos auxiliares.
- Selección directa de una caja en la escena: abrió la ficha de Barras de cereal, posición B06.
- Giro por arrastre: cambió la orientación del almacén.
- Selección mediante buscador, ficha de producto y apertura del detalle verificadas.
- Capas de demanda y conexiones verificadas; la demanda sustituye la leyenda de familias por su escala.
- Filtro de familias y retorno a Todos verificados.
- Vista superior, isométrica, ampliación y salida con Escape verificadas.
- Reproducción completa: ocho movimientos y 100 % de progreso. Las ocho tareas siguieron pendientes, sin modificación de la operación.
- Pausa: mantuvo el mismo progreso entre observaciones; reinicio disponible.
- Plano 2D: 32 ubicaciones disponibles al cambiar de vista.
- Comparación del plan: Frutos secos aparece en A06 en Actual y en C08 en Propuesta.
- Ancho móvil verificado: contenido de 375 px dentro de una vista de 375 px, sin desbordamiento horizontal.
- Sin errores de JavaScript en las comprobaciones del navegador.

El 3D y los recorridos son una representación ilustrativa para demostrar la experiencia del producto. No son una integración con un almacén físico ni un sistema de navegación real.
