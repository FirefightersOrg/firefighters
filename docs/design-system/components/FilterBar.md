# FilterBar

La parte de arriba de una lista: un campo de búsqueda primero, los demás filtros plegados bajo «Filtrar» y lo aplicado a la vista como etiquetas que se pueden quitar. En el teléfono deja la primera fila de la lista dentro de la primera pantalla. _Adición del rediseño (docs/ux/direction.md, «Lists»)._

## Qué provee quien lo usa

- `action`: la URL de la lista. Es un formulario `GET`.
- `searchName`, `searchLabel`, `searchValue`, `searchError`, `inputmode`: el campo de búsqueda (un número de bono, un nombre).
- `filters` opcional: los demás campos. Si la lista solo tiene búsqueda, se omite y no aparece «Filtrar».
- `applied`: los filtros en uso, cada uno con `label` («Estado: Vendido») y `removeHref` (la misma lista sin ese filtro).
- `clearHref`: la lista sin filtros.
- `open`: empezar con los filtros desplegados (después de un error de validación en alguno).

## Reglas

- Funciona sin JavaScript y cada estado tiene su URL: se puede compartir y volver atrás.
- El campo de búsqueda es el dato con el que la gente llega (el número del bono, el apellido).
- «Filtrar» muestra cuántos filtros hay aplicados.
- Un error en un filtro plegado abre el bloque (`open`): nunca queda un error escondido.
