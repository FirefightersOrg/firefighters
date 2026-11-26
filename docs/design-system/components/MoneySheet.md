# MoneySheet

Montos que se suman, leídos de arriba hacia abajo como una planilla de caja: líneas, un filete sobre cada subtotal y un filete doble sobre la cifra principal. Nació en la rendición cerrada; donde se sume plata tiene que verse así, en pantalla y en papel. _Adición del rediseño (docs/ux/direction.md, «Money sheets»)._

## Qué provee quien lo usa

- `rows`: las líneas, cada una con `label`, `value` y `kind`:
  - `line` (por defecto): un monto que suma;
  - `subtotal`: lleva un filete arriba;
  - `deduction`: un monto que se resta; va atenuado, con «−», y se lee «menos»;
  - `lead`: la cifra para la que existe la planilla, bajo filete doble y en la tipografía de cifras. Una sola.
- `secondary` opcional: montos de referencia debajo de la planilla, más chicos; no entran en la suma.
- `context`: `screen` (pesos enteros) o `document` (con centavos). Ver `Money`.

## Reglas

- Las cuentas se hacen antes, en centavos (`$lib/domain/money`): el componente solo muestra.
- Debajo de la planilla va la oración sobre la que se actúa («Jorge Medina tiene que entregar $ 63.000 en efectivo»).
- No meter la planilla dentro de una tarjeta que ya está dentro de otra.
- Cada grupo del `<dl>` contiene solo un `dt` y un `dd`.
