# Anulaciones y correcciones

## Objetivo

Definir flujos seguros para corregir errores sin borrar historial.

## Principio general

```txt
No borrar informacion historica sensible.
Anular, ajustar o compensar con auditoria.
```

## Pago mal cargado

```txt
Pago confirmado
↓
Usuario solicita anulacion
↓
Sistema exige motivo
↓
Sistema anula pago
↓
Sistema revierte estado de cuotas afectadas
↓
Sistema genera movimiento compensatorio de comision si corresponde
↓
Sistema registra auditoria
```

Reglas:

- Si el pago estaba en una rendicion cerrada, no se modifica la rendicion original.
- Se crea una correccion vinculada a la rendicion.

## Medio de pago incorrecto

```txt
Pago confirmado con medio incorrecto
↓
Usuario solicita correccion
↓
Sistema exige motivo
↓
Sistema registra ajuste de medio de pago
↓
Sistema recalcula impacto en efectivo, transferencia y cuenta corriente
↓
Sistema genera movimientos compensatorios
```

Ejemplo:

- Si era efectivo y debia ser transferencia, cambia el impacto de caja y puede cambiar saldo a favor del cobrador.

## Venta con comprador equivocado

```txt
Venta registrada
↓
Sistema verifica si tiene pagos confirmados
↓
Si no tiene pagos confirmados, permite correccion autorizada
↓
Si tiene pagos confirmados, exige correccion auditada con motivo
↓
Sistema conserva snapshot historico
```

Reglas:

- Si ya hubo rendiciones o premios, la correccion debe requerir rol autorizado.
- No debe perderse el comprador originalmente registrado.

## Bono vendido por cobrador equivocado

```txt
Detectar cobrador incorrecto
↓
Sistema verifica rendiciones asociadas
↓
Si no hay rendiciones cerradas, permite correccion autorizada
↓
Si hay rendiciones cerradas, genera ajuste entre cobradores
↓
Sistema registra auditoria
```

Reglas:

- No mover comisiones historicas sin movimiento compensatorio.
- Si el error afecta cuenta corriente, crear movimientos en ambos cobradores.

## Rendicion cerrada con diferencia

```txt
Rendicion cerrada
↓
Usuario registra correccion con motivo
↓
Sistema crea ajuste vinculado a la rendicion original
↓
Sistema genera movimientos compensatorios
↓
Sistema actualiza saldos calculados
```

Reglas:

- No reabrir rendicion.
- No editar totales originales.
- El ajuste debe aparecer en la cuenta corriente y reportes.

## Comision calculada incorrectamente

```txt
Detectar diferencia
↓
Usuario con permiso registra ajuste de comision
↓
Sistema exige motivo
↓
Sistema crea movimiento de cuenta corriente
↓
Sistema audita accion
```

## Premio cargado mal

```txt
Premio registrado
↓
Usuario autorizado solicita anulacion
↓
Sistema exige motivo
↓
Sistema marca resultado anterior como anulado
↓
Usuario carga resultado correcto si corresponde
↓
Sistema conserva ambos eventos en auditoria
```

## Bono asignado al cobrador equivocado

```txt
Asignacion registrada
↓
Si bono no fue vendido, permitir reasignacion auditada
↓
Si bono fue vendido, corregir venta y asignacion con rol autorizado
↓
Si hubo pagos/rendiciones, generar ajustes necesarios
```

## Transferencia mal asociada

```txt
Transferencia asociada a pago incorrecto
↓
Usuario solicita correccion
↓
Sistema anula asociacion anterior
↓
Sistema asocia transferencia al pago correcto
↓
Sistema ajusta cuotas, comisiones y cuenta corriente
↓
Auditoria
```

## Campos minimos de una correccion

- Tipo de correccion.
- Entidad afectada.
- Entidad relacionada.
- Motivo.
- Usuario.
- Fecha.
- Valor anterior.
- Valor nuevo.
- Movimientos compensatorios generados.
