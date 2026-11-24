# Badge

Etiqueta corta de estado o categoría, con punto de color y palabra.

## Qué provee quien lo usa

- `children`: una o dos palabras («Activa», «Con observaciones»).
- `tone`: `neutral` (borrador, sin estado), `info` (cerrado, en proceso), `success` (activo, correcto), `warning` (pendiente, por vencer), `danger` (anulado, rechazado).
- `dot={false}` para categorías que no son estados.

## Reglas

- Mapear cada estado del dominio a un tono una sola vez, en un único lugar del código, y reutilizarlo.
- El texto siempre presente: el color solo no comunica.
- No es un botón: no es clicable.
