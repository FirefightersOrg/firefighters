# Comisiones

## Objetivo

Definir como calcular, confirmar, ajustar y auditar comisiones de cobradores.

## Regla principal

La comision se calcula de forma preliminar durante la rendicion abierta y se consolida al cerrar la rendicion.

## Tipos de reglas

### Regla general de campana

Aplica a todos los cobradores salvo que exista una regla especial.

Ejemplos:

- Pago contado.
- Primera cuota.
- Cuotas intermedias.
- Ultima cuota.

### Regla especial por cobrador

Permite que un cobrador tenga condiciones diferentes.

Ejemplos:

- Mayor porcentaje por acuerdo especifico.
- Menor porcentaje.
- Monto fijo.
- Regla valida solo por una fecha o campana.

### Ajuste manual

Permite corregir o modificar una comision calculada.

Requisitos:

- Permiso `commission.adjust`.
- Motivo obligatorio.
- Auditoria obligatoria.
- Movimiento de cuenta corriente asociado.

## Prioridad de calculo

```txt
1. Regla especial activa del cobrador
2. Regla general de campana
3. Ajuste manual autorizado
```

El ajuste manual no reemplaza la regla original; debe quedar registrado como diferencia.

## Flujo normal

```txt
Rendicion abierta
↓
Usuario agrega pagos
↓
Sistema calcula comision preliminar
↓
Usuario revisa
↓
Cierre de rendicion
↓
Sistema confirma comision
↓
Sistema crea movimiento de cuenta corriente
```

## Flujo de ajuste manual en rendicion abierta

```txt
Usuario con permiso revisa comision
↓
Ingresa ajuste
↓
Sistema exige motivo
↓
Sistema recalcula resumen
↓
Al cerrar rendicion se confirma ajuste
```

## Flujo de ajuste posterior a rendicion cerrada

```txt
Rendicion cerrada
↓
Usuario detecta diferencia
↓
Registra ajuste de comision con motivo
↓
Sistema crea movimiento compensatorio
↓
Sistema audita accion
```

## Cuenta corriente

Toda comision confirmada genera un movimiento:

```txt
entry_type = comision_generada
direction = collector_credit
```

Toda comision liquidada o pagada genera:

```txt
entry_type = comision_liquidada
direction = collector_debit
```

## Datos minimos de una regla

- Campana.
- Tipo de regla.
- Porcentaje o monto fijo.
- Cobrador especifico si aplica.
- Vigencia.
- Usuario que la creo.
- Estado.

## Datos minimos de un ajuste

- Cobrador.
- Rendicion si aplica.
- Pago si aplica.
- Monto del ajuste.
- Direccion del ajuste.
- Motivo.
- Usuario.
- Fecha.
