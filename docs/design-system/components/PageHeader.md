# PageHeader

Encabezado de cada página: un enlace de vuelta, título (`h1`), descripción y acciones.

## Qué provee quien lo usa

- `title`, `description`, `actions`.
- `breadcrumbs` `{ label, href? }[]`: el camino hasta la página, del más general al más particular; el último es la página misma y va sin `href`.

## Reglas

- Un solo `PageHeader` por página; su acción `primary` es la única de la vista.
- Del camino se muestra un solo enlace, «Volver a …», hacia el último padre. La navegación de la aplicación ya dice dónde está la página; una ruta de cuatro enlaces se parte en dos líneas en el teléfono.
- No se muestra el enlace cuando el padre es uno que la navegación ya ofrece en todas las páginas (el inicio de la campaña, la lista de campañas, el inicio del portal). Lo declara la navegación con `setPageHeaderRoots`.
- En pantallas táctiles el enlace mide 44 px de alto.
