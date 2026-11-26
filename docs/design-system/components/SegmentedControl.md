# SegmentedControl

Una elección entre dos o tres opciones que quedan a la vista: botones contiguos en lugar de un desplegable (Efectivo / Transferencia, Pago total / En cuotas). _Adición del rediseño (docs/ux/direction.md, «Task flows»)._

## Qué provee quien lo usa

- `legend`: el nombre del grupo; visible arriba salvo `hideLegend`.
- `options`: dos o tres, con `value`, `label` y `disabled` opcional.
- `value` (enlazable), `defaultValue`, `name` para el formulario, `onchange`.

## Reglas

- Dos o tres opciones. Con más, `Select` o `RadioGroup`.
- Son radios nativos: `Tab` entra al grupo, las flechas mueven y eligen, y se envía con el formulario sin JavaScript.
- La opción elegida lleva relleno, peso 600 y una tilde: no depende solo del color.
- Siempre hay una opción elegida por defecto, la más frecuente.
- 44 px de alto en pantallas táctiles.
