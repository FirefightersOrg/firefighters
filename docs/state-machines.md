# Maquinas de estado

## Objetivo

Definir estados y transiciones permitidas para las entidades principales. Las correcciones deben preservar trazabilidad y evitar perdida de historial.

## Campana

Estados:

```txt
borrador
activa
en_cierre
cerrada
anulada
```

Transiciones:

```txt
borrador -> activa
activa -> en_cierre
en_cierre -> cerrada
activa -> anulada
```

Reglas:

- Una campana cerrada no permite operaciones normales.
- Las correcciones posteriores requieren rol autorizado y auditoria.

## Bono

Estados comerciales:

```txt
creado
disponible
entregado_a_cobrador
vendido
devuelto
extraviado
anulado
cerrado
```

Transiciones principales:

```txt
creado -> disponible
disponible -> entregado_a_cobrador
entregado_a_cobrador -> vendido
entregado_a_cobrador -> devuelto
devuelto -> disponible
disponible -> extraviado
entregado_a_cobrador -> extraviado
vendido -> anulado
vendido -> cerrado
```

Reglas:

- Un bono vendido no puede reasignarse directamente.
- Un bono con pagos confirmados solo puede corregirse con anulacion auditada.
- La perdida o extravio debe registrar responsable, fecha y motivo.

## Estado financiero de bono

Estados calculados:

```txt
sin_pagos
con_pagos_parciales
al_dia
atrasado
pagado_completo
incobrable
anulado
```

Reglas:

- El estado financiero se calcula desde cuotas y pagos confirmados.
- No debe reemplazar el estado comercial.
- Un bono puede estar `vendido` y `atrasado` al mismo tiempo.

## Cuota

Estados:

```txt
pendiente
pagada
pagada_adelantada
vencida
anulada
```

Transiciones:

```txt
pendiente -> pagada
pendiente -> pagada_adelantada
pendiente -> vencida
vencida -> pagada
pagada -> anulada
pagada_adelantada -> anulada
```

Reglas:

- Una cuota pagada por error no se borra; se anula el pago asociado.
- El estado vencida puede ser calculado segun fecha de vencimiento y pagos confirmados.

## Pago

Estados:

```txt
borrador
pendiente_en_rendicion
confirmado
anulado
ajustado
```

Transiciones:

```txt
borrador -> pendiente_en_rendicion
pendiente_en_rendicion -> confirmado
pendiente_en_rendicion -> anulado
confirmado -> anulado
confirmado -> ajustado
```

Reglas:

- Un pago confirmado no se edita directamente.
- Si cambia medio de pago, importe o cuota, se registra anulacion o ajuste.
- Los pagos confirmados impactan elegibilidad de sorteos y reportes.

## Rendicion

Estados:

```txt
abierta
cerrada
anulada
corregida
```

Transiciones:

```txt
abierta -> cerrada
abierta -> anulada
cerrada -> corregida
```

Reglas:

- Una rendicion abierta se puede editar.
- Una rendicion cerrada no se reabre.
- Una rendicion cerrada no se edita directamente.
- Todo error posterior se corrige mediante anulacion o ajuste auditado.
- El cierre confirma pagos, comisiones y movimientos de cuenta corriente.

## Movimiento de cuenta corriente

Estados:

```txt
registrado
anulado
compensado
```

Tipos de movimiento:

```txt
comision_generada
comision_liquidada
efectivo_rendido
transferencia_recibida_por_bomberos
ajuste_a_favor_cobrador
ajuste_a_favor_bomberos
anulacion
```

Reglas:

- El saldo se calcula desde movimientos no anulados.
- No deben editarse montos historicos directamente.

## Sorteo

Estados:

```txt
programado
padron_generado
padron_congelado
realizado
cerrado
anulado
```

Transiciones:

```txt
programado -> padron_generado
padron_generado -> padron_congelado
padron_congelado -> realizado
realizado -> cerrado
programado -> anulado
```

Reglas:

- No se cargan ganadores sin padron congelado, salvo excepcion administrativa auditada.
- El padron congelado no debe recalcularse dinamicamente.

## Premio

Estados:

```txt
pendiente_de_validacion
adjudicado
pendiente_de_entrega
entregado
no_adjudicado
anulado
```

Transiciones:

```txt
pendiente_de_validacion -> adjudicado
pendiente_de_validacion -> no_adjudicado
adjudicado -> pendiente_de_entrega
pendiente_de_entrega -> entregado
adjudicado -> anulado
```

Reglas:

- Si el bono no estaba habilitado en el padron congelado, el premio queda no adjudicado.
- La entrega del premio debe registrar fecha, usuario y observacion.
