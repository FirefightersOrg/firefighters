# AppHeader

Barra superior fija con producto, navegación principal y sesión.

## Qué provee quien lo usa

- `product` (nombre o marca), `homeHref`, `links` `{ label, href, current? }[]`, `user` (nombre visible), `userActions`.

## Reglas

- Entre 3 y 6 destinos; la sección actual con `current` (`aria-current="page"`).
- Por debajo de 720px los enlaces pasan a un menú desplegable con objetivos de 44px.
- «Cerrar sesión», nunca «Log out» ni «Salir».
