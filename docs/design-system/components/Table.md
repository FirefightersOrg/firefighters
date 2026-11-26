# Table

Tabla de datos con encabezado fijo, cifras alineadas y filas seleccionables.

## Qué provee quien lo usa

- `columns`: `{ key, header, align?: 'left'|'right'|'center', mono?, width?, render?(row) }`.
- `rows`, `rowKey` (por defecto `id`), `caption`, `density` `comfortable | compact`, `selectedKey`, `onRowClick(row)`, `maxHeight` (activa desplazamiento con encabezado fijo), `empty` (contenido para tabla vacía).

## Reglas

- Montos y cantidades: `align: 'right'` (aplica cifras tabulares). Códigos: `mono`.
- Estados: `Badge` dentro de la celda.
- Acciones de fila al final, `ghost` `sm`; si son más de dos, un menú.
- Si la fila es clicable, también debe haber un enlace o botón real dentro (teclado).
- En móvil la tabla se desplaza dentro de su contenedor, nunca la página.

## En el teléfono: `stack`

Con `stack`, por debajo de 720 px cada fila pasa a ser un bloque de líneas en lugar de una tira de columnas que hay que desplazar de costado. Cada columna dice dónde va con `stack`:

- `primary`: abre la fila (el identificador y el dato principal).
- `trailing`: al final de esa primera línea (un monto o un estado).
- `secondary`: la segunda línea, atenuada.
- `hidden`: no se muestra en el teléfono.
- sin valor: sigue como una línea con el encabezado de la columna adelante («Vence: 22/08/2026»).

La tabla conserva filas, celdas y encabezados para lectores de pantalla (los roles van explícitos). El contenedor de la tabla contiene a sus descendientes con posición absoluta (por ejemplo un texto `sr-only` dentro de una celda), que de otro modo se escapan del desplazamiento horizontal y ensanchan toda la página.
