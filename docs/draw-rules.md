# Reglas de sorteos

## Objetivo

Definir reglas funcionales de elegibilidad para los sorteos del MVP.

## Tipos de sorteo

- Mensual.
- Extraordinario por pago total.
- Final.
- Consuelo.

## Sorteo mensual

Regla:

```txt
Para participar debe tener paga la cuota requerida del sorteo y todas las anteriores antes de la fecha de corte.
```

Ejemplo:

```txt
Sorteo diciembre
Cuota requerida: 3
Debe tener pagas cuotas 1, 2 y 3 antes del corte.
```

## Sorteo extraordinario por pago total

Regla:

```txt
Participan quienes hayan pagado el total del bono antes de la fecha de corte.
```

Numeros extra:

```txt
Bono simple = 1 numero extra
Pata = N numeros extra segun cantidad de numeros base
```

Ejemplo:

```txt
Pata con 5 numeros base
Participacion normal: 5 base + 5 asociados = 10 numeros
Participacion extraordinaria adicional: 5 numeros extra
```

Los numeros extra deben quedar persistidos o congelados en el padron del sorteo extraordinario para justificar resultados historicos.

## Sorteo final

Regla definida:

```txt
Para ganar el sorteo final, el bono debe estar completamente pago.
```

La validacion debe hacerse contra pagos confirmados antes del corte definido para el sorteo final.

## Sorteos consuelo

Regla definida:

```txt
Participan solo bonos no ganadores y que esten al dia.
```

Condiciones:

- No haber ganado en sorteos previos que excluyan de consuelo.
- Estar al dia segun cuota requerida o regla configurada del consuelo.
- Figurar habilitado en el padron congelado.

## Padron congelado

Todos los sorteos deben tener padron congelado antes de cargar ganadores.

El padron debe incluir:

- Habilitados.
- No habilitados.
- Motivo de no habilitacion.
- Numero participante.
- Bono.
- Comprador.
- Cobrador.
- Fecha/hora de generacion.
- Fecha/hora de congelamiento.

## Carga de ganador

```txt
Ingresar numero ganador
↓
Buscar en padron congelado
↓
Determinar bono asociado
↓
Verificar habilitacion
↓
Registrar resultado
```

Resultados posibles:

- Ganador habilitado.
- Premio no adjudicado por falta de pago.
- Premio no adjudicado por no cumplir regla del sorteo.
- Numero sin coincidencia.
- Pendiente de revision.
