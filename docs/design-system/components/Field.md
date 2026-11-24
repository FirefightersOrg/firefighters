# Field

Envuelve un control con su etiqueta, ayuda y error, y los conecta por accesibilidad.

## Qué provee quien lo usa

- `label` (obligatorio, tipo oración, sin dos puntos).
- `hint`: formato esperado o para qué se usa el dato. Visible siempre, no como placeholder.
- `error`: qué está mal + cómo arreglarlo. Al tener error, el control recibe `aria-invalid` y `aria-describedby`.
- `optional`: agrega «(opcional)». Marcar lo opcional, no lo obligatorio.
- `children`: un `TextInput`, `Select` o `Textarea` (heredan `id` y atributos de accesibilidad).

## Reglas

- Validar al salir del campo y al enviar, nunca mientras se escribe.
- El placeholder no reemplaza la etiqueta: solo muestra un ejemplo.
- Ancho del campo acorde al dato (un código postal no ocupa toda la fila).
