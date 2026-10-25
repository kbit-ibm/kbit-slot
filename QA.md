# Verificación del diseñador de almacenes

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
