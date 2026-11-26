# BondStub

El número de un bono dibujado como el talón del bono de papel: franja roja `brand`, corte punteado con dos muescas y el número en la tipografía de cifras. Es el único gesto visual fuerte del producto y, junto con la marca de la institución, el único lugar donde aparece el rojo `brand`.

## Qué provee quien lo usa

- `number`: ya formateado con los dígitos de la campaña (`"0100"`).
- `caption`: el texto chico arriba del número («Premio 1», «Bono»).
- `detail` opcional: una línea debajo.
- `size`: `lg` (por defecto: 40 px en teléfono, 54 px en escritorio) o `md` (32 / 40 px) para encabezados más densos.

## Reglas

- Solo donde el bono es el sujeto: el número ganador de un premio y el encabezado de la ficha del bono.
- Nunca como decoración en una lista ni repetido muchas veces en una pantalla; en listas va `BondNumber`.
- El texto visible es el texto accesible: no lleva `aria-label`, para que un lector de pantalla lea «0100» como está escrito.
- Nunca más ancho que su contenedor.
