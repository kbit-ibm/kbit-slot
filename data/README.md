# Datos sintéticos para Kbit Slot

Todos los productos y pedidos son sintéticos. Los nombres parten del catálogo del
proyecto; las presentaciones adicionales son variantes inventadas, no registros
extraídos de una base externa. No representan ventas ni inventario real.

| Conjunto | Productos | Pedidos | Ubicaciones | Uso |
| --- | ---: | ---: | ---: | --- |
| milp-8 | 8 | 150 | 16 | MILP, clásico y QAOA |
| demo-30 | 30 | 500 | 32 | Catálogo original y comparación de motores |
| almacen-1000 | 1.000 | 10.000 | 1.120 | Datos de mayor volumen para clásico y QAOA por bloques |

## Cargar desde la página

1. Pulsa **Importar pedidos** (o **Importar datos**, según la vista).
2. Elige **Importar operación completa (JSON)**.
3. Selecciona `data/almacen-1000/request.json`.
4. La página muestra el catálogo importado y el plano de sus ubicaciones.
   En **Preparar turno** elige el motor y genera el plan.

Si tienes un diseño guardado, la importación conserva exactamente su geometría,
dimensiones, estantes, niveles y huecos. Los productos se asignan a sus direcciones
reales; las restricciones de ubicación del archivo se traducen a esas direcciones.
La vista 2D, la escena 3D, las rutas y los cálculos usan ese mismo diseño. Las
operaciones importadas previamente se vinculan al diseño guardado al recargar;
los planes anteriores se invalidan al cambiar de geometría. La vinculación no
amplía el edificio: si no caben todos los productos más una reserva, se pide
ajustar el diseño, conservando los datos anteriores.

Sin diseño guardado se usa el plano rectangular incluido en el archivo.
Este plano también tiene vista **3D / Plano**. Con más de 24
posiciones por pasillo, la vista 3D empieza en el primer sector; el selector
**Sector** permite recorrerlos y **Ver almacén completo** encuadra todo el plano.
Buscar un producto enfoca su sector. Demanda, conexiones y reproducción usan
el catálogo y las ubicaciones importadas. Los productos y estantes se dibujan
en lotes para evitar crear una escena separada por cada SKU.

La importación completa reemplaza el catálogo, la distribución, los pedidos y las
reglas de la operación activa. Se valida antes de aplicarse y se conserva en el
navegador, vinculada a su diseño. Usa Ayuda → Reiniciar
demostración para salir de la operación importada.

El CSV habitual **solo reemplaza pedidos del catálogo activo**. No crea productos.
El conjunto de 1.000 productos tiene más de 5.000 líneas: usa su JSON completo;
el importador CSV conserva su límite de 5.000 líneas.
Los conjuntos de 8 y 30 productos también incluyen CSV de pedidos compatible
con sus respectivas instancias. El CSV de 30 productos es compatible con el
catálogo demo original; la operación completa también carga su distribución y reglas.

## Archivos de cada conjunto

- `request.json`: entrada directa de `POST /api/solve`: `spec` (plano, catálogo,
  familias), `initial` (posición por ID de producto), `orders`, `rules`, `solver`
  y `options`. También se importa en la página.
- `products.csv`: ID consecutivo, SKU, nombre y familia.
- `locations.csv`: índice, dirección, pasillo, nivel y reserva temporal.
- `assignment.csv`: relación SKU → dirección inicial.
- `orders.csv`: pedido, SKU, cantidad y fecha sintéticas de septiembre de 2026.
- `metadata.json`: procedencia sintética, semilla, cantidades e índice inicial.

El objetivo actual cuenta **apariciones conjuntas por pedido**, sin ponderar por
cantidad. Cantidad y fecha se incluyen como información adicional; no alteran el
objetivo. No se modelan stock, reposición, peso, volumen, vencimientos ni
capacidades físicas: los algoritmos actuales asignan una ubicación por SKU.
Las distancias están expresadas en unidades del plano, no metros.

La generación combina canastas frecuentes, preferencia de familia, productos de
alta demanda y pedidos mixtos. Cada SKU aparece al menos una vez. La distribución
inicial está mezclada y es factible. Las familias de limpieza se restringen al
pasillo D y los alimentos/bebidas a A–C; hay una reserva temporal libre en D.
Las zonas restringen posiciones finales; no certifican separación sanitaria real.

## Reproducir y usar por API

```bash
npm run data:generate
npm test
curl -X POST http://127.0.0.1:8000/api/solve \
  -H 'Content-Type: application/json' \
  --data-binary @data/almacen-1000/request.json
```

La API devuelve un ID de trabajo que se consulta con `GET /api/jobs/{id}`.
La página pasa el mismo catálogo y plano al motor seleccionado.

MILP admite hasta 14 productos movibles y 120.000 variables: no resuelve los
1.000 productos libres a la vez. QAOA trabaja por bloques pequeños, no necesita
un qubit por producto del catálogo. El conjunto grande se validó en estructura,
referencias, demanda y distribución inicial; no se ha establecido aún su tiempo
de optimización ni su calidad. Para simulación o hardware cambia `solver` y
`options` según `docs/QISKIT.md`; usar IBM requiere las credenciales del servidor.
