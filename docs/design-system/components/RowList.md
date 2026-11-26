# RowList y Row

Una lista de registros como filas en lugar de tabla: lo que es una lista por debajo de 720 px, y lo que es una lista corta dentro de una ficha a cualquier ancho. _Adición del rediseño (docs/ux/direction.md, «Lists»)._

## Qué provee quien lo usa

`RowList`:

- `label`: el nombre accesible de la lista («Pagos de esta rendición»).
- `empty` opcional: lo que se muestra cuando no hay filas, en general un `EmptyState`.

`Row`, una por registro:

- `title`: la primera línea, el dato principal (un nombre, «Cuota 3 de 6»).
- `detail` opcional: la segunda línea, texto simple. Para estados con `Badge`, usar `meta`.
- `lead` opcional: lo que identifica la fila, antes del texto; casi siempre un `BondNumber`.
- `trailing` opcional: al final, un monto o un estado.
- `href` opcional: toda la fila pasa a ser el enlace.
- `actions` opcional: los controles de la fila (`RowActions`).

## Reglas

- Dos líneas por fila: qué es, y su estado o detalle. Lo demás va a la ficha.
- Con `href` hay un solo enlace por fila (una parada de tabulación) y la fila mide al menos 56 px.
- Las acciones de fila quedan por encima del enlace y siguen siendo clicables.
- Sin tarjeta alrededor de cada fila: las separa un filete.
- Una lista de más de 10 filas dentro de una ficha muestra las primeras 10 y enlaza a la lista completa.
