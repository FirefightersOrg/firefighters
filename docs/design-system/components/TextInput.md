# TextInput

Campo de texto de una línea, 40px de alto y fuente de 16px.

## Qué provee quien lo usa

- Atributos de `<input>` (`type`, `inputMode`, `autoComplete`, `defaultValue`…).
- `prefix`: símbolo fijo a la izquierda (`$`, `#`).
- `mono`: para códigos, documentos y números de serie.
- `invalid`: si se usa fuera de `Field`.

## Reglas

- Usar `inputMode="numeric"` o `"decimal"` para cifras (teclado correcto en móvil), no `type="number"`.
- `autoComplete` correcto en datos personales (`name`, `email`, `tel`).
- Solo lectura (`readOnly`) cuando el valor existe pero no se edita; se puede copiar.
