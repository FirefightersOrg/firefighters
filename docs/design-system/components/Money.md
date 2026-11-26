# Money

Un monto en pesos. Aplica una sola regla por contexto, para que el mismo bloque no mezcle `$ 153.000,00` con `$ 545.000`. _Adición del rediseño._

## Qué provee quien lo usa

- `value`: un número o un texto decimal (`"1500.50"`). Los valores nulos o inválidos se muestran como «—».
- `context`: `screen` (por defecto) o `document`.

## Reglas

- `screen`: pesos enteros cuando no hay centavos (`$ 150.500`); si los hay, se muestran (`$ 1.500,50`). Para pantallas.
- `document`: siempre con centavos (`$ 150.500,00`). Para documentos imprimibles y la cuenta corriente.
- No mezclar los dos contextos en un mismo bloque.
- El signo `$` y la cifra nunca se separan en dos líneas.
- Un monto negativo lleva «−» a la vista y se lee «menos» con lector de pantalla. No usar color solo para marcarlo.
- Alinear a la derecha en tablas y planillas; las cifras son tabulares.
