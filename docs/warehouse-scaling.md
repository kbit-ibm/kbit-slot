# Diseño y optimización a gran escala

El editor y el optimizador tienen problemas de escala diferentes. Esta versión implementa el diseño visual, sin backend.

## Representación implementada

Se guarda una configuración de tamaño constante: cantidades y medidas, sin crear un objeto por ubicación. La capacidad se deriva por multiplicación. Los sectores abarcan hasta cuatro pasillos y diez módulos por lado; las direcciones de ubicación son estables y no dependen del sector de visualización.

La vista general de un edificio con más de 400 estantes dibuja sectores. Al entrar en uno se genera su geometría detallada, con un máximo de 80 estantes. Los postes, travesaños, superficies y cajas usan `THREE.InstancedMesh`, compartiendo geometría y materiales. La escena se dibuja durante la interacción y se detiene cuando la cámara está quieta. El plano SVG permite continuar sin WebGL.

No se calcula una matriz de distancias entre todas las ubicaciones del edificio. El modelo admite 921.600 ubicaciones teóricas con 160 sectores en la configuración máxima; el límite no equivale a una prueba de optimización a esa escala.

## Siguiente etapa del producto

1. Convertir el diseño guardado en un grafo de circulación: pasillos, cruces y zonas de empaque. Calcular rutas bajo demanda y mantener una caché acotada.
2. Importar ubicaciones e inventario del cliente y asociar SKUs a direcciones. Añadir restricciones reales: dimensiones, peso, peligrosidad, equipos y acceso.
3. Agrupar por zonas, demanda y afinidad; resolver primero la asignación a zonas y después las reubicaciones locales. Usar un presupuesto de movimientos y controlar la congestión entre sectores.
4. Comparar una referencia clásica y una propuesta híbrida sobre los mismos datos y restricciones, midiendo calidad del objetivo, tiempo total, memoria y tareas ejecutables. Si se evalúa QAOA u otro método cuántico, empezar con subproblemas pequeños y contabilizar también preparación, colas, ejecución y decodificación.

El motor actual sigue siendo una búsqueda local clásica para el ejemplo de 30 SKUs. Conectar directamente un diseño grande a ese motor produciría resultados incorrectos porque sus distancias y restricciones dependen del plano fijo.

El enfoque cuántico sigue siendo una hipótesis a evaluar. IBM indica que sigue abierta la cuestión de cuándo y para qué problemas la optimización cuántica ofrecerá una ventaja clara frente a los mejores métodos clásicos: [Quantum computing in context](https://quantum.cloud.ibm.com/learning/en/courses/use-a-qc-today/quantum-computing-context). Por tanto, ni la capacidad de la interfaz ni una cantidad grande de ubicaciones demuestran ventaja cuántica.

Referencia de renderizado: [Three.js InstancedMesh](https://threejs.org/docs/pages/InstancedMesh.html).
