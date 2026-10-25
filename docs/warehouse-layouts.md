# Cuatro geometrías, un mismo diseñador

El tipo de almacén define la orientación física de las filas y de sus vías principales. La selección, la cámara, el zoom, el plano 2D, las direcciones de ubicación, el detalle por sectores y el guardado usan la misma implementación en las cuatro geometrías.

| Tipo | Distribución | Control específico | Cantidad de filas |
|---|---|---|---|
| Paralelo | Filas rectas y cruces transversales | Separación de accesos | Pasillos totales |
| Flying-V | Filas rectas con un acceso diagonal en V | Profundidad de la V, 25–80 % del fondo | Pasillos totales |
| Fishbone | Dos zonas superiores verticales y dos inferiores horizontales, separadas por la V | Profundidad de la V, 25–80 % | Filas por zona; hasta cuatro zonas |
| Chevron | Dos alas de filas inclinadas conectadas a una vía central | Ángulo de las filas, 30–60° | Pasillos por ala; dos alas |

Al cambiar de tipo se conservan las cantidades y medidas. Los controles de filas explican su significado para cada geometría. La capacidad se calcula sobre los estantes generados: `estantes que caben × niveles × huecos`. Flying-V elimina los módulos que invadirían su acceso; Fishbone recorta las filas a sus zonas. Por ello, el máximo de módulos configurado no garantiza esa misma cantidad en cada fila.

El modelo devuelve la posición, orientación y dimensiones físicas de cada módulo, con direcciones únicas `Pxx-I/D-Exx-Nxx-Uxx`. El SVG y Three.js consumen esa misma geometría. Las pruebas revisan los límites del edificio, intersecciones entre estantes y separación de las vías señaladas.

Por encima de 400 estantes se muestra una representación simplificada con la misma estructura de postes, bandejas y travesaños. Cada tramo conserva su orientación y se interrumpe en los accesos. Al seleccionar un sector se muestran sus módulos detallados, hasta 80 por sector. La selección 3D sigue las formas reales de los tramos, evitando usar cajas de sector que se superpongan sobre filas inclinadas.

Se guarda el esquema `version: 2` en la misma clave local. Los esquemas anteriores se normalizan como Paralelo; conservan cantidades, medidas y códigos. No se elimina el diseño anterior al iniciar la aplicación. Solo Guardar diseño sustituye el valor almacenado.

Las geometrías son aproximaciones paramétricas para explorar el producto, inspiradas en los diseños descritos por [Kevin Gue](https://kevingue.wordpress.com/research/aisle-design-for-warehouses/). No son soluciones óptimas de disposición ni justifican porcentajes de ahorro. El adaptador de operación conecta las cuatro formas al motor mediante un grafo de circulación propio de cada geometría. La animación, las tareas y el plano usan las mismas direcciones del diseño guardado. Se trabaja con una muestra de hasta 64 ubicaciones y 30 productos sintéticos; ver [su alcance](warehouse-operation.md).
