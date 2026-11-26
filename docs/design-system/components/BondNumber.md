# BondNumber

El número de un bono, tal como está impreso en el talón: con ceros a la izquierda, en la tipografía de cifras (IBM Plex Sans Condensed 700) y sin cortarse entre líneas. Es la forma en que se nombra un bono en listas, fichas y formularios. _Adición del rediseño (docs/ux/direction.md, principio 1)._

## Qué provee quien lo usa

- `number`: el número base. Si es un número se completa con ceros hasta `digits`; si es texto se muestra como llega.
- `associated` opcional: el número asociado, que va después, más chico (`0181 / 5181`).
- `digits`: los dígitos de la campaña (por defecto 4).
- `size`: `sm` (16 px, tablas densas), `md` (20 px, por defecto) o `lg` (28 px, encabezados).
- `href` opcional: lo convierte en enlace a la ficha del bono. La ruta la resuelve quien lo usa.

## Reglas

- Un número de bono nunca va dentro de un texto corrido en la tipografía del cuerpo ni en monoespaciada: siempre con este componente.
- Siempre con los ceros a la izquierda de la campaña.
- En una fila de lista va primero.
- Como enlace mide 44 px de alto en pantallas táctiles.
