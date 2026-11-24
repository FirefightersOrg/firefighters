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
