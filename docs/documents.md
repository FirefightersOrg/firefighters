# Documentos imprimibles

## Objetivo

Definir documentos operativos del MVP. La primera version usara HTML imprimible. PDF persistente queda como mejora futura.

## Decision MVP

```txt
Formato inicial: HTML imprimible
```

Motivos:

- Menor complejidad tecnica.
- Facil de imprimir desde navegador.
- Suficiente para remitos administrativos.
- Puede evolucionar a PDF sin cambiar los datos base.

## Regla general

Los datos estructurados deben guardarse en base de datos. El HTML es solo una representacion imprimible.

## Remito de entrega de bonos

Debe incluir:

- Nombre de la institucion.
- Campana.
- Numero de remito.
- Fecha.
- Cobrador.
- Usuario que registra.
- Bonos entregados.
- Tipo de bono.
- Numeros base y asociados.
- Codigo de barras si existe.
- Observaciones.
- Firma de cobrador.
- Firma de administracion.

## Remito de rendicion

Debe incluir:

- Campana.
- Numero de rendicion.
- Fecha de apertura y cierre.
- Cobrador.
- Usuario que cierra.
- Pagos incluidos.
- Bono.
- Comprador.
- Cuotas pagadas.
- Medio de pago.
- Total efectivo.
- Total transferencia.
- Total general.
- Comision generada.
- Comision liquidada.
- Ajustes manuales.
- Neto para Bomberos.
- Saldo resultante del cobrador.
- Observaciones.
- Firmas.

## Constancia de pago

Debe incluir:

- Campana.
- Bono.
- Numeros participantes principales.
- Comprador.
- Cobrador.
- Cuotas cubiertas.
- Importe.
- Medio de pago.
- Fecha de pago.
- Fecha de registracion.
- Usuario que registro.
- Numero de comprobante interno.

## Constancia de premio entregado

Debe incluir:

- Sorteo.
- Fecha.
- Premio.
- Numero ganador.
- Bono asociado.
- Comprador.
- Cobrador.
- Estado en padron.
- Fecha de entrega.
- Usuario que registra.
- Observaciones.
- Firma de receptor.

## Constancia de premio no adjudicado

Debe incluir:

- Sorteo.
- Premio.
- Numero ganador.
- Bono asociado si existe.
- Comprador si existe.
- Motivo de no adjudicacion.
- Estado en padron.
- Usuario que registra.
- Fecha.
- Observaciones.

## Versionado futuro

A futuro se puede agregar:

- Generacion PDF.
- Persistencia de PDF en storage.
- Codigo QR de validacion.
- Firma digital o sello institucional.
