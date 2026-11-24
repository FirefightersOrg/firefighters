# PageHeader

Encabezado de cada página: ruta, título (`h1`), descripción y acciones.

## Qué provee quien lo usa

- `title`, `description`, `breadcrumbs` `{ label, href? }[]` (el último sin `href`), `actions`.

## Reglas

- Un solo `PageHeader` por página; su acción `primary` es la única de la vista.
- La ruta empieza en la sección, no en «Inicio».
