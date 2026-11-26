# Badge

Etiqueta corta de estado o categoría, con una marca y una palabra. La marca cambia de forma con el tono, además de color: redonda para `neutral`, `info` y `success`, rombo para `warning` y cuadrada para `danger`.

## Qué provee quien lo usa

- `children`: una o dos palabras («Activa», «Con observaciones»).
- `tone`: `neutral` (borrador, sin estado), `info` (cerrado, en proceso), `success` (activo, correcto), `warning` (pendiente, por vencer), `danger` (anulado, rechazado).
- `dot={false}` para categorías que no son estados.

## Reglas

- Mapear cada estado del dominio a un tono una sola vez, en un único lugar del código, y reutilizarlo.
- El texto siempre presente: el color solo no comunica. La forma de la marca es una segunda señal, no un reemplazo de la palabra.
- No es un botón: no es clicable.
