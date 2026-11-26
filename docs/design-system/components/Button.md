# Button

Dispara una acción; el texto es verbo + objeto en tipo oración («Guardar cambios», «Importar archivo»).

## Cuándo usar

- `primary`: la acción por la que existe la vista. **Una por vista.**
- `secondary` (por defecto): acciones alternativas o frecuentes.
- `ghost`: acciones terciarias, cerrar, acciones de fila en tablas.
- `danger`: solo para la confirmación final de algo destructivo, dentro de un `Dialog`. En la página, «Anular» abre el diálogo con `secondary`.

## Qué provee quien lo usa

- `children`: el texto (máx. 3 palabras). Sin texto → `icon` + `aria-label` obligatorio.
- `variant` `primary | secondary | ghost | danger`; `size` `sm | md | lg`; `icon`, `iconEnd` (nombre de `Icon`); `block` ancho completo; `loading`; `href` lo convierte en enlace.
- Cualquier atributo de `<button>` (`type`, `onClick`, `form`…).

## Hacer / evitar

- Hacer: `loading` mientras la acción corre; el ancho no cambia y el botón queda inactivo. El texto queda transparente (no oculto), así el botón conserva su nombre para lectores de pantalla.
- Hacer: `size="lg"` + `block` para la acción principal en móvil.
- Evitar: deshabilitar sin explicar; preferir dejarlo activo y validar con un mensaje.
- Evitar: «Aceptar», «Sí», «OK», «Click aquí».
