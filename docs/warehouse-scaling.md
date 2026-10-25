# Diseño y optimización a gran escala

El editor y el optimizador tienen problemas de escala diferentes. Esta versión implementa el diseño visual, sin backend.

## Representación implementada

Se guarda una configuración compacta: geometría, cantidades y medidas, sin crear un objeto por ubicación. Se generan los módulos que caben en cada distribución y la capacidad se deriva de su número, niveles y huecos. Los sectores abarcan hasta cuatro filas y diez módulos por lado dentro de una misma zona; las direcciones de ubicación no dependen del sector de visualización. Ver [cuatro geometrías](warehouse-layouts.md).

La vista general de un edificio con más de 400 estantes dibuja sectores. Al entrar en uno se genera su geometría detallada, con un máximo de 80 estantes. Los postes, travesaños, superficies y cajas usan `THREE.InstancedMesh`, compartiendo geometría y materiales. La escena se dibuja durante la interacción y se detiene cuando la cámara está quieta. El plano SVG permite continuar sin WebGL.

El diseñador no calcula una matriz de distancias entre todas las ubicaciones del edificio. La configuración máxima del tipo Paralelo representa 921.600 ubicaciones teóricas en 160 sectores; los otros tipos cambian el número de alas, zonas y módulos que caben. El límite no equivale a una prueba de optimización a esa escala.

## Siguiente etapa del producto

1. Convertir el diseño guardado en un grafo de circulación: pasillos, cruces y zonas de empaque. Calcular rutas bajo demanda y mantener una caché acotada.
2. Importar ubicaciones e inventario del cliente y asociar SKUs a direcciones. Añadir restricciones reales: dimensiones, peso, peligrosidad, equipos y acceso.
3. Agrupar por zonas, demanda y afinidad; resolver primero la asignación a zonas y después las reubicaciones locales. Usar un presupuesto de movimientos y controlar la congestión entre sectores.
4. Comparar una referencia clásica y una propuesta híbrida sobre los mismos datos y restricciones, midiendo calidad del objetivo, tiempo total, memoria y tareas ejecutables. Si se evalúa QAOA u otro método cuántico, empezar con subproblemas pequeños y contabilizar también preparación, colas, ejecución y decodificación.

La interfaz de operación usa el ejemplo de 30 SKUs. El motor ya ofrece planos parametrizados y un contrato de propuestas externas; la integración remota incluye el trabajo Qiskit descrito en [su documentación](QISKIT.md). El diseñador continúa separado de esa operación. Las distancias rectangulares del contrato actual no describen las vías en V o las filas inclinadas: hace falta un adaptador de circulación antes de conectarlas.

El enfoque cuántico sigue siendo una hipótesis a evaluar. IBM indica que sigue abierta la cuestión de cuándo y para qué problemas la optimización cuántica ofrecerá una ventaja clara frente a los mejores métodos clásicos: [Quantum computing in context](https://quantum.cloud.ibm.com/learning/en/courses/use-a-qc-today/quantum-computing-context). Por tanto, ni la capacidad de la interfaz ni una cantidad grande de ubicaciones demuestran ventaja cuántica.

Referencia de renderizado: [Three.js InstancedMesh](https://threejs.org/docs/pages/InstancedMesh.html).
