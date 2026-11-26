# RowActions

Las acciones poco frecuentes de una fila, detrás de un solo control «…». Evita que cada línea de una lista lleve su campo de motivo y su botón de quitar a la vista. _Adición del rediseño (docs/ux/direction.md, «Risky operations»)._

## Qué provee quien lo usa

- `label`: sobre qué actúa el control («Acciones del pago del bono 0019»). No tiene texto visible, así que este nombre es obligatorio.
- `actions`: cada una con `label` y `onselect` (o `href`); `tone: 'danger'` para las destructivas.

## Reglas

- Una acción destructiva nunca se ejecuta al elegirla: `onselect` abre un `Dialog` que nombra el objeto, dice la consecuencia y pide el motivo si corresponde.
- La acción frecuente de una fila no va acá: va como botón visible.
- `Esc` o un clic afuera lo cierran, y el foco vuelve al control.
- Cada opción mide 44 px de alto.
