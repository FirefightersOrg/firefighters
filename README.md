# Modelo de negocio — Sistema de Gestión de Rifas / Bonos de Bomberos

## 1. Objetivo del sistema

El objetivo del sistema es reemplazar el sistema actual obsoleto y los controles manuales en Excel por una aplicación web moderna, eficiente e intuitiva para gestionar integralmente las rifas/bonos de los Bomberos Voluntarios.

El sistema debe permitir administrar todo el ciclo de vida de una campaña anual de bonos:

1. Crear una nueva campaña anual.
2. Cargar bonos simples y bonos tipo “pata”.
3. Asignar bonos a vendedores/cobradores.
4. Registrar ventas a compradores.
5. Registrar pagos de contado, pagos por cuota y pagos adelantados.
6. Controlar cobranzas y rendiciones de cobradores.
7. Calcular comisiones.
8. Controlar saldos a favor de cobradores o de Bomberos.
9. Gestionar sorteos mensuales, extraordinarios, consuelos y sorteo final.
10. Determinar si un bono está habilitado para participar/cobrar premio.
11. Registrar ganadores y premios.
12. Emitir remitos, constancias, reportes y respaldos.

La aplicación será web y deberá estar pensada para ser accesible desde distintos dispositivos.

---

## 2. Terminología del negocio

Para evitar confusiones, se propone estandarizar estos términos dentro del sistema.

| Término | Significado |
|---|---|
| Campaña | Período anual del bono/rifa. Ejemplo: “Bono Contribución 2025-2026”. |
| Sorteo | Evento puntual dentro de una campaña. Puede ser mensual, final, consuelo o extraordinario. |
| Bono | Cartón físico que se vende a un comprador. Puede ser simple o pata. |
| Bono simple | Bono individual con un número base visible y un número asociado calculado. |
| Pata | Bono con varios números base. Se vende como una unidad comercial más grande, usualmente a empresas o comercios. |
| Número base | Número principal impreso en el bono. |
| Número asociado | Número calculado a partir del número base sumando 4871. |
| Número participante | Cualquier número que participa en sorteos: número base o número asociado. |
| Comprador | Persona, comercio o empresa que compra un bono. |
| Cobrador / Vendedor | Persona que recibe bonos, los vende, cobra cuotas y rinde a Bomberos. |
| Entrega de bonos | Acto administrativo por el cual Bomberos entrega bonos físicos a un cobrador. |
| Venta | Acto por el cual un bono queda asociado a un comprador. |
| Pago | Registro de dinero abonado por un comprador. Puede ser efectivo o transferencia. |
| Rendición | Acto por el cual un cobrador informa pagos, entrega dinero y se calcula su comisión. |
| Comisión | Porcentaje o monto que corresponde al cobrador por la venta/cobro. |
| Liquidación de comisión | Pago efectivo de comisiones acumuladas a favor del cobrador. |
| Padrón de sorteo | Lista congelada de bonos/números habilitados para participar en un sorteo. |

---

## 3. Campañas

Una campaña representa el período anual completo de una edición del bono.

Ejemplo:

```text
Campaña: Bono Contribución 2025-2026
Valor del bono simple: $60.000
Cantidad de cuotas: 10
Valor de cada cuota: $6.000
```

Una campaña contiene:

- Bonos simples.
- Bonos tipo pata.
- Compradores.
- Cobradores.
- Entregas de bonos.
- Ventas.
- Pagos.
- Rendiciones.
- Sorteos mensuales.
- Sorteo extraordinario por pago total.
- Sorteos consuelo.
- Sorteo final.
- Premios.
- Reglas de comisión.
- Reglas de elegibilidad.

### 3.1. Ciclo anual de una campaña

El flujo general es:

```text
1. Finaliza la campaña anterior.
2. Se crea la nueva campaña.
3. Llegan los bonos impresos.
4. Se cargan los bonos simples y patas en el sistema.
5. Se revisan los números históricos de compradores del año anterior.
6. Se asignan bonos a los cobradores.
7. Los cobradores se llevan los bonos físicos.
8. Los cobradores venden los bonos.
9. Los cobradores rinden ventas y pagos a la administración.
10. Administración registra compradores, pagos, cuotas y medios de pago.
11. El sistema calcula comisiones y saldos.
12. Mensualmente se generan padrones de sorteo.
13. Se cargan números ganadores.
14. El sistema valida si el bono ganador estaba habilitado.
15. Se registran premios.
16. Al finalizar el período, se cierra la campaña.
```

---

## 4. Bonos

El bono es la unidad vendible del sistema.

Un bono puede ser:

1. Bono simple.
2. Bono tipo pata.

Ambos son bonos. La diferencia está en la cantidad de números base que contienen y, por consecuencia, en su valor.

---

## 5. Bono simple

Un bono simple posee:

- Un número base.
- Un número asociado calculado.
- Un comprador, si fue vendido.
- Un cobrador asignado.
- Un plan de pago.
- Cuotas.
- Pagos.
- Estado comercial.
- Estado financiero.

Ejemplo real observado:

```text
Número base: 1658
Número asociado: 6529
```

La relación es:

```text
1658 + 4871 = 6529
```

Por lo tanto:

```text
número_asociado = número_base + 4871
```

### 5.1. Regla principal del bono simple

Aunque visualmente parezca que el bono tiene dos números independientes, en realidad tiene:

```text
1 número base
+
1 número asociado calculado automáticamente
```

El comprador del bono participa con ambos números.

Ejemplo:

```text
Bono 1658

Participa con:
- 1658
- 6529
```

Si sale sorteado cualquiera de esos dos números, el ganador es el mismo bono.

```text
Si sale 1658 → gana el Bono 1658
Si sale 6529 → gana el Bono 1658
```

El sistema debe evitar interpretar esos números como dos bonos distintos.

---

## 6. Número asociado +4871

Todos los bonos usan una lógica de número asociado.

Regla:

```text
número asociado = número base + 4871
```

Esta regla debe estar configurada en el sistema, idealmente a nivel campaña, para no dejarla fija en el código.

### 6.1. Objetivo operativo

El número asociado está ligado al mismo bono. El objetivo es que el mismo bono tenga más de una chance de salir sorteado sin que se genere doble asignación de premio a dos bonos distintos.

### 6.2. Validación de duplicados

El sistema debe validar que un número participante no se repita dentro de la misma campaña.

Número participante significa:

- número base,
- número asociado calculado.

Ejemplo de situación problemática:

```text
Bono A:
base 1658
asociado 6529

Bono B:
base 6529
asociado 11400
```

En este caso, el número 6529 quedaría ligado a dos bonos diferentes. El sistema debería impedirlo, advertirlo o exigir una resolución administrativa.

### 6.3. Duda pendiente sobre límite de 4 cifras

Todavía debe confirmarse qué ocurre cuando:

```text
número_base + 4871 > 9999
```

Ejemplo:

```text
7000 + 4871 = 11871
```

Posibles reglas a confirmar:

1. Nunca se usan números base tan altos.
2. Se toman las últimas 4 cifras.
3. Existe un rango máximo permitido para los números base.
4. La campaña puede trabajar con más de 4 cifras en ciertos casos.

Hasta confirmar esta regla, el sistema debe tratarlo como una validación pendiente.

---

## 7. Bonos tipo “pata”

Una pata es un bono impreso que posee varios números base.

No debe modelarse como muchos bonos separados, sino como:

```text
1 bono tipo pata
+
varios números base
+
varios números asociados calculados
```

Ejemplo conceptual:

```text
Pata 1200

Números base:
- 1200
- 1315
- 2200
- 3100
- 4500

Números asociados:
- 6071
- 6186
- 7071
- 7971
- 9371
```

Si una pata tiene 5 números base, participa con 10 números totales.

### 7.1. Venta de patas

Las patas se venden como una unidad.

Habitualmente se venden a empresas, comercios o compradores grandes porque tienen más números y, por lo tanto, mayor valor.

### 7.2. Valor de una pata

El valor de una pata debe depender de la cantidad de números/unidades comerciales que contiene.

Regla probable, pendiente de confirmación exacta:

```text
Bono simple = 1 unidad comercial = 1 número base + 1 número asociado
Pata = N unidades comerciales
Valor pata = valor bono simple × N
```

Ejemplo:

```text
Bono simple:
1 número base
1 número asociado
Valor: $60.000

Pata con 5 números base:
5 números base
5 números asociados
Valor probable: $300.000
```

Esta regla debe confirmarse con administración o con el sistema anterior antes de implementarse definitivamente.

---

## 8. Creación de nuevas patas

Además de las patas impresas, puede ocurrir que se necesite armar una nueva pata agrupando varios bonos simples.

Esto sucede cuando:

- no quedan patas impresas disponibles,
- un comprador desea comprar varios números,
- una empresa o comercio solicita una pata.

En ese caso, el sistema debe permitir agrupar bonos simples.

### 8.1. Regla de trazabilidad

Cuando se arma una pata con bonos simples, no se debe perder la identidad original de esos bonos.

El sistema debe registrar:

- qué bonos simples fueron agrupados,
- cuándo se agruparon,
- quién realizó la agrupación,
- para qué cobrador o comprador se agrupó,
- si luego se desagrupó,
- motivo de la agrupación o desagrupación.

### 8.2. Venta de una pata armada

Aunque esté armada a partir de bonos simples, comercialmente debe poder venderse como una pata/paquete único.

---

## 9. Historial y reserva de números

Una característica importante del negocio es que muchos compradores quieren conservar el mismo número todos los años.

Por eso, al comenzar una nueva campaña, se intenta asignar a cada cobrador los mismos números que vendió el año anterior a los mismos compradores.

### 9.1. Reserva histórica

El sistema debería registrar el historial de números por comprador.

Ejemplo:

```text
Comprador: Diego Fernández
Número habitual: 0068
Cobrador habitual: Juan Pérez
Última campaña: 2024-2025
```

Al cargar la nueva campaña, el sistema debería ayudar a detectar:

```text
El número 0068 está disponible.
Puede asignarse nuevamente al comprador histórico.
```

O:

```text
El número 0068 este año pertenece a una pata.
No está disponible como bono simple.
Debe ofrecerse un número alternativo.
```

### 9.2. Conflicto con patas

Puede ocurrir que un número que históricamente compraba una persona ahora pertenezca a una pata.

En ese caso:

1. El número no se asigna al comprador histórico.
2. Se asigna otro número al cobrador.
3. El cobrador informa al comprador que su número habitual no está disponible.
4. Se registra la reasignación para mantener trazabilidad.

---

## 10. Asignación de bonos a cobradores

Antes de comenzar la campaña, Bomberos entrega bonos físicos a los cobradores.

Esta entrega debe registrarse formalmente en el sistema.

### 10.1. Entrega de bonos

Una entrega debe contener:

- número de entrega/remito,
- fecha,
- cobrador,
- usuario administrador que la registró,
- listado de bonos entregados,
- observaciones,
- estado,
- posibilidad de impresión.

Ejemplo:

```text
Remito de entrega N° 000123
Fecha: 01/09/2025
Cobrador: Juan Pérez

Bonos entregados:
- Bono 0068
- Bono 0100
- Pata 1200
- Pata 1300
```

### 10.2. Estado del bono después de la entrega

Cuando se entrega a un cobrador:

```text
Disponible en administración
→ Entregado a cobrador
```

Esto no significa que el bono esté vendido.

Solo significa que el cobrador tiene físicamente el bono.

### 10.3. Devolución o desasignación

Debe existir la posibilidad de:

- devolver bonos a administración,
- desasignar bonos de un cobrador,
- reasignar bonos a otro cobrador,
- registrar pérdida/extravío,
- anular una asignación errónea.

Todas estas acciones deben quedar auditadas.

---

## 11. Venta de bonos

La venta ocurre cuando el cobrador informa que un bono fue vendido a un comprador.

La venta debe registrar:

- bono vendido,
- cobrador que lo vendió,
- comprador,
- fecha de venta,
- modalidad de pago,
- cantidad de cuotas si aplica,
- pago inicial si corresponde,
- medio de pago,
- observaciones.

### 11.1. Modalidades de venta

El comprador puede pagar:

1. De contado.
2. En cuotas.
3. En cuotas con adelantos posteriores.
4. En cuotas pero completando el total antes del sorteo extraordinario.

### 11.2. Estado del bono después de la venta

Ejemplo:

```text
Entregado a cobrador
→ Vendido
```

El estado financiero dependerá de los pagos:

```text
Sin pagos
Con pagos parciales
Al día
Atrasado
Pagado completo
```

No conviene mezclar el estado comercial con el financiero.

Un bono puede estar:

```text
Estado comercial: vendido
Estado financiero: atrasado
```

---

## 12. Compradores

Los compradores pueden ser:

- personas físicas,
- comercios,
- empresas,
- instituciones.

Datos mínimos:

- nombre,
- apellido o razón social,
- domicilio,
- teléfono,
- documento o CUIT si se decide registrarlo,
- observaciones,
- cobrador habitual,
- historial de bonos comprados,
- historial de números.

### 12.1. Historial del comprador

El sistema debería permitir ver:

- campañas en las que participó,
- bonos comprados,
- números comprados,
- pagos realizados,
- deuda pendiente,
- premios ganados,
- cobradores asociados.

---

## 13. Plan de pago y cuotas

Cada bono vendido debe tener un plan de pago.

Ejemplo de la campaña observada:

```text
Valor total del bono simple: $60.000
Cantidad de cuotas: 10
Valor cuota: $6.000
```

Cada cuota debe registrar:

- número de cuota,
- mes correspondiente,
- vencimiento,
- importe,
- estado,
- fecha de pago,
- medio de pago,
- cobrador asociado,
- rendición asociada,
- comisión generada.

### 13.1. Estados posibles de una cuota

```text
Pendiente
Pagada
Pagada adelantada
Vencida
Anulada
```

### 13.2. Pago adelantado

Un comprador puede pagar cuotas antes de su vencimiento.

El sistema debe permitir seleccionar varias cuotas y pagarlas en una misma operación.

Ejemplo:

```text
El comprador paga cuota 3, 4 y 5 juntas.
```

El sistema debe registrar:

- fecha real del pago,
- cuotas cubiertas,
- medio de pago,
- rendición,
- comisión generada por cada cuota o por el pago total, según regla de campaña.

---

## 14. Pago de contado

Cuando un comprador paga el total del bono, el bono queda como pagado completo.

```text
Estado financiero:
Pagado completo
```

Además, si paga dentro de las condiciones establecidas, participa del sorteo extraordinario por pago total.

### 14.1. Sorteo extraordinario por pago total

El comprador que paga de contado participa con números extra.

Regla conversada:

- Si compra un bono simple, obtiene 1 número extra para el sorteo extraordinario.
- Si compra una pata, obtiene N números extra según la cantidad de números/unidades comerciales que haya comprado.

### 14.2. Pago total posterior

Si un comprador comienza pagando en cuotas y luego completa todo el pago antes de la fecha límite del sorteo extraordinario, debería participar del sorteo extraordinario.

Si completa el pago después de esa fecha límite, solo queda con cuotas adelantadas/pagadas, pero no participa del sorteo extraordinario ya realizado.

Ejemplo:

```text
Fecha sorteo extraordinario: 27/12/2025
Fecha límite para pago total: 26/12/2025

Bono A:
Pagó completo el 20/12/2025 → participa

Bono B:
Pagó completo el 28/12/2025 → no participa
```

---

## 15. Medios de pago

El sistema debe diferenciar claramente el medio de pago.

Medios mínimos:

1. Efectivo.
2. Transferencia.

Opcionalmente en el futuro:

- tarjeta de débito,
- tarjeta de crédito,
- billetera virtual,
- cheque,
- otro.

---

## 16. Pagos en efectivo

En pagos en efectivo:

```text
Comprador → paga al cobrador
Cobrador → rinde a Bomberos
```

El cobrador puede entregar a Bomberos el dinero neto luego de descontar su comisión, o puede rendir el total y cobrar comisión después, según la operatoria administrativa.

El sistema debe permitir registrar:

- total cobrado en efectivo,
- comisión generada,
- comisión descontada en la rendición,
- efectivo entregado a Bomberos,
- saldo pendiente.

---

## 17. Pagos por transferencia

Regla confirmada:

```text
Comprador → transfiere directo a Bomberos
```

En este caso, Bomberos recibe el total del pago.

Pero el cobrador sigue generando comisión.

Por lo tanto:

```text
Pago transferencia: $6.000
Bomberos recibió: $6.000
Comisión cobrador: $1.500
Saldo a favor del cobrador: $1.500
```

Esto obliga a manejar una cuenta corriente del cobrador.

---

## 18. Comisiones

El sistema debe calcular comisiones de cobradores.

Regla general conocida:

```text
Comisión general: 25%
```

Pero hay una regla adicional:

- Si el bono se paga en cuotas, el cobrador cobra comisión por cada cuota.
- La primera cuota y la última cuota pueden tener un porcentaje de comisión más alto.
- Las cuotas intermedias pueden tener otro porcentaje.

Por lo tanto, la comisión no debe estar fija en el código.

Debe ser configurable por campaña.

### 18.1. Configuración de comisiones por campaña

Ejemplo conceptual:

```text
Campaña 2025-2026

Comisión pago contado: 25%

Comisión cuotas:
- Cuota 1: porcentaje especial
- Cuotas intermedias: porcentaje normal
- Última cuota: porcentaje especial
```

Los porcentajes reales deben cargarse según las reglas administrativas de Bomberos.

### 18.2. Comisión generada vs comisión pagada

El sistema debe separar:

```text
Comisión generada
```

de:

```text
Comisión liquidada/pagada
```

Ejemplo:

```text
Comisiones generadas: $50.000
Comisiones pagadas: $20.000
Saldo pendiente a favor del cobrador: $30.000
```

Esto permite acumular comisiones y liquidarlas después.

---

## 19. Cuenta corriente del cobrador

Cada cobrador debe tener una cuenta corriente interna.

No necesariamente representa una cuenta bancaria. Representa el saldo administrativo entre Bomberos y el cobrador.

Debe registrar movimientos como:

- comisiones generadas,
- comisiones pagadas,
- efectivo rendido,
- transferencias recibidas por Bomberos,
- saldos a favor del cobrador,
- saldos a favor de Bomberos,
- ajustes,
- anulaciones.

### 19.1. Ejemplo con pago por transferencia

```text
Comprador paga por transferencia: $6.000
Bomberos recibe: $6.000
Comisión generada: $1.500
Saldo a favor del cobrador: $1.500
```

### 19.2. Ejemplo con pago en efectivo

```text
Comprador paga en efectivo: $6.000
Comisión generada: $1.500
Neto para Bomberos: $4.500
```

---

## 20. Rendiciones de cobradores

La rendición es uno de los procesos centrales del sistema.

Hoy parte de esta información se controla en Excel. El nuevo sistema debe reemplazar ese Excel.

### 20.1. Qué es una rendición

Una rendición es el momento en que el cobrador informa a administración:

- qué bonos vendió,
- qué cuotas cobró,
- qué pagos recibió,
- qué pagos fueron en efectivo,
- qué pagos fueron por transferencia,
- cuánto corresponde de comisión,
- cuánto dinero queda para Bomberos,
- cuánto saldo queda a favor del cobrador.

### 20.2. Datos de una rendición

Una rendición debe contener:

- número de rendición,
- fecha,
- cobrador,
- usuario administrador,
- pagos incluidos,
- total cobrado,
- total efectivo,
- total transferencia,
- comisión generada,
- comisión liquidada en esa rendición,
- saldo a favor del cobrador,
- neto para Bomberos,
- observaciones,
- estado,
- remito imprimible.

### 20.3. Resumen de rendición

Ejemplo:

```text
Rendición N° 00045
Fecha: 10/10/2025
Cobrador: Juan Pérez

Pagos:
- Bono 0068 - Cuota 1 - $6.000 - efectivo
- Bono 0100 - Cuota 1 - $6.000 - transferencia
- Pata 1200 - Pago contado - $300.000 - efectivo

Total efectivo: $306.000
Total transferencia: $6.000
Total general: $312.000

Comisión generada: $78.000
Comisión liquidada: $50.000
Saldo a favor cobrador: $28.000
Neto Bomberos: $234.000
```

### 20.4. Remito de rendición

El sistema debe imprimir un remito de rendición para el cobrador y la administración.

Debe incluir:

- cobrador,
- fecha,
- listado de bonos/cuotas/pagos,
- medio de pago,
- importes,
- comisiones,
- total efectivo,
- total transferencia,
- neto Bomberos,
- saldo cobrador,
- firmas.

---

## 21. Resumen mensual por cobrador

El sistema debe poder generar un resumen para cada cobrador con:

- todos los bonos asignados,
- números base y asociados,
- comprador de cada bono,
- estado de venta,
- cuotas pagas,
- cuotas pendientes,
- cuotas vencidas,
- pagos adelantados,
- total recaudado,
- total pendiente,
- comisión generada,
- saldo a favor o en contra.

Este resumen es clave para el seguimiento operativo mensual.

---

## 22. Sorteos

Una campaña tiene distintos sorteos.

Tipos conocidos:

1. Sorteos mensuales.
2. Sorteo final.
3. Sorteos consuelo.
4. Sorteo extraordinario por pago total.

Cada sorteo debe registrar:

- campaña,
- tipo,
- fecha,
- descripción,
- cuota requerida hasta cierto mes, si aplica,
- fecha/hora de corte para pagos,
- premios,
- números ganadores,
- padrón de habilitados,
- estado.

---

## 23. Sorteos mensuales

Los sorteos mensuales requieren que el bono esté al día.

Regla confirmada:

Para participar debe estar paga:

```text
la cuota correspondiente al mes del sorteo
+
todas las cuotas anteriores
```

Ejemplo:

```text
Sorteo diciembre 2025
Cuota requerida: 3

Debe tener pagas:
- cuota 1
- cuota 2
- cuota 3
```

Si falta una cuota anterior o la cuota del mes:

```text
El bono no está habilitado para cobrar premio.
```

### 23.1. Fecha de corte

Cada sorteo debería tener una fecha/hora de corte para determinar pagos válidos.

Ejemplo:

```text
Sorteo: Diciembre 2025
Fecha del sorteo: 27/12/2025
Corte de pagos: 26/12/2025 23:59
```

Esto evita discusiones si alguien paga después del sorteo.

---

## 24. Padrón de sorteo

Antes de cada sorteo se debe generar un padrón de participantes habilitados.

El padrón debe quedar congelado.

No debe recalcularse dinámicamente después, porque alguien podría pagar tarde y alterar la situación histórica.

### 24.1. Datos del padrón

El padrón debe registrar:

- sorteo,
- bono,
- números participantes,
- comprador,
- cobrador,
- si está habilitado,
- motivo si no está habilitado,
- fecha/hora de generación.

Ejemplo:

```text
Sorteo mensual diciembre 2025

Bono 0068:
Cuotas 1, 2 y 3 pagas antes del corte
Estado: habilitado

Bono 0090:
Cuota 3 impaga
Estado: no habilitado
Motivo: deuda de cuota 3
```

---

## 25. Carga de números ganadores

El sistema debe permitir cargar rifas/bonos beneficiados o números ganadores.

Debe soportar números de distinta cantidad de cifras, por ejemplo:

- 3 cifras,
- 4 cifras.

Al cargar un número ganador, el sistema debe buscar coincidencias contra:

- números base,
- números asociados calculados,
- números extraordinarios si corresponde al sorteo.

### 25.1. Validación de ganador

Cuando se carga un número ganador, el sistema debe determinar:

1. Qué bono corresponde a ese número.
2. Quién es el comprador.
3. Qué cobrador lo vendió.
4. Si estaba habilitado en el padrón.
5. Si corresponde entregar premio.
6. Si el premio queda rechazado/no adjudicado por falta de pago.
7. Si queda pendiente de revisión.

---

## 26. Regla de premio ante falta de pago

Regla confirmada:

Si alguien no paga la cuota correspondiente, y se realizó el sorteo, no recibirá el premio.

Por lo tanto:

```text
Número ganador
→ Buscar bono
→ Revisar padrón congelado
→ Si estaba habilitado, puede cobrar
→ Si no estaba habilitado, no corresponde premio
```

El sistema debe dejar registro del resultado.

Ejemplo:

```text
Número ganador: 6529
Bono asociado: 1658
Comprador: Diego Fernández
Estado en padrón: no habilitado
Motivo: cuota 3 impaga

Resultado: premio no adjudicado por falta de pago
```

---

## 27. Sorteo extraordinario por pago total

Este sorteo es exclusivo para compradores que hayan pagado el bono completo dentro de la fecha límite definida.

Participan quienes:

- pagaron de contado al inicio,
- o completaron todas las cuotas antes de la fecha límite del sorteo extraordinario.

No participan quienes completaron el pago después del sorteo o después de la fecha de corte.

### 27.1. Números extra

Al pagar de contado o completar el pago a tiempo, el comprador participa con números extra.

Regla conversada:

- Bono simple: 1 número extra.
- Pata: N números extra, según la cantidad de unidades comerciales/números base que incluya.

Esta regla exacta debe confirmarse con administración antes de implementarse.

---

## 28. Sorteo final

El sorteo final ocurre al concluir la campaña.

Debe tener sus propios premios y reglas de elegibilidad.

Según la información disponible, debería requerir que el bono esté al día o completamente pago, pero esta regla debe confirmarse explícitamente.

---

## 29. Sorteos consuelo

Los sorteos consuelo forman parte de la campaña y deben modelarse como sorteos independientes.

Deben tener:

- fecha,
- premios,
- reglas de elegibilidad,
- padrón,
- números ganadores,
- resultado.

La regla exacta de participación debe confirmarse.

---

## 30. Código de barras

El bono impreso tiene código de barras.

Actualmente se intentó usar para escanear bonos y registrar más rápido, pero no funciona correctamente.

### 30.1. Regla actual no confirmada

No está confirmado si el código de barras representa:

1. el número base visible,
2. el número del bono,
3. un identificador interno,
4. otro dato del sistema anterior.

La hipótesis actual es que representa el número visible superior.

### 30.2. Recomendación para el nuevo sistema

El sistema nuevo debe tener un identificador interno propio para cada bono.

Ejemplo:

```text
BONO-2025-2026-000068
```

Y además guardar, si existe:

- código de barras impreso,
- número base,
- campaña,
- tipo de bono.

El escaneo debería permitir:

1. Buscar bono.
2. Abrir ficha del bono.
3. Registrar venta.
4. Registrar pago.
5. Incluir bono/cuota en una rendición.

No se debe depender exclusivamente del código de barras viejo si no se confirma su significado.

---

## 31. Estados del bono

El bono debería tener al menos dos dimensiones de estado:

1. Estado operativo/comercial.
2. Estado financiero.

### 31.1. Estado operativo/comercial

Estados posibles:

```text
Creado
Disponible en administración
Entregado a cobrador
Vendido
Devuelto
Anulado
Extraviado
Cerrado
```

### 31.2. Estado financiero

Estados posibles:

```text
Sin pagos
Con pagos parciales
Al día
Atrasado
Pagado completo
Incobrable
Anulado
```

No conviene usar un solo estado para todo, porque un bono puede estar vendido y atrasado al mismo tiempo.

---

## 32. Auditoría y trazabilidad

El sistema debe estar diseñado para no perder historial.

Regla recomendada:

```text
No borrar información histórica.
Anular, corregir o revertir mediante movimientos auditados.
```

Deben quedar auditadas acciones como:

- creación de campaña,
- carga de bonos,
- asignación de bonos,
- devolución de bonos,
- venta,
- cambio de comprador,
- registro de pago,
- anulación de pago,
- creación de rendición,
- liquidación de comisión,
- generación de padrón,
- carga de ganador,
- entrega o rechazo de premio,
- armado/desarmado de patas,
- cambios de configuración.

Cada auditoría debería registrar:

- usuario,
- fecha/hora,
- acción,
- entidad afectada,
- valor anterior,
- valor nuevo,
- motivo u observación.

---

## 33. Usuarios y permisos

El sistema debe tener usuarios con roles.

Roles iniciales sugeridos:

### 33.1. Administrador

Puede:

- crear campañas,
- configurar reglas,
- cargar bonos,
- asignar bonos,
- registrar ventas,
- registrar pagos,
- crear rendiciones,
- liquidar comisiones,
- gestionar sorteos,
- cargar ganadores,
- emitir reportes,
- administrar usuarios.

### 33.2. Operador administrativo

Puede:

- registrar ventas,
- registrar pagos,
- generar rendiciones,
- consultar bonos,
- consultar compradores,
- imprimir remitos,
- generar reportes operativos.

No debería poder cambiar reglas críticas de campaña.

### 33.3. Cobrador

Puede, si se decide darle acceso:

- ver sus bonos asignados,
- ver compradores asociados,
- ver cuotas pendientes,
- informar pagos,
- consultar su saldo de comisión.

Inicialmente podría no tener acceso y operar todo desde administración.

### 33.4. Visualizador / Auditor

Puede:

- consultar información,
- ver reportes,
- no modificar datos.

---

## 34. Reportes necesarios

El sistema debe permitir generar reportes como mínimo de:

### 34.1. Bonos

- bonos disponibles,
- bonos entregados,
- bonos vendidos,
- bonos devueltos,
- bonos anulados,
- bonos extraviados,
- patas disponibles,
- patas vendidas,
- bonos por cobrador,
- bonos por comprador.

### 34.2. Pagos

- cuotas pagas,
- cuotas pendientes,
- cuotas vencidas,
- pagos por fecha,
- pagos por medio de pago,
- pagos por cobrador,
- pagos por comprador,
- pagos adelantados.

### 34.3. Cobradores

- resumen mensual por cobrador,
- bonos asignados,
- bonos vendidos,
- deuda pendiente,
- efectivo rendido,
- transferencias registradas,
- comisiones generadas,
- comisiones liquidadas,
- saldo a favor del cobrador,
- saldo a favor de Bomberos.

### 34.4. Rendiciones

- rendiciones por fecha,
- rendiciones por cobrador,
- detalle de pagos incluidos,
- total efectivo,
- total transferencia,
- comisión,
- neto Bomberos.

### 34.5. Sorteos

- padrón de habilitados,
- padrón de no habilitados,
- números ganadores,
- ganadores habilitados,
- ganadores rechazados por deuda,
- premios entregados,
- premios pendientes.

### 34.6. Compradores

- historial por comprador,
- números habituales,
- deuda por comprador,
- bonos comprados,
- premios ganados.

---

## 35. Constancias y remitos

El sistema debe emitir documentos imprimibles.

### 35.1. Remito de entrega de bonos al cobrador

Debe incluir:

- número de remito,
- fecha,
- cobrador,
- listado de bonos entregados,
- números base y asociados,
- tipo de bono,
- observaciones,
- firma del cobrador,
- firma de administración.

Debe imprimirse al menos por duplicado:

- copia para cobrador,
- copia para administración.

### 35.2. Constancia/remito de rendición

Debe incluir:

- número de rendición,
- fecha,
- cobrador,
- pagos rendidos,
- bonos,
- cuotas,
- compradores,
- medios de pago,
- importes,
- comisiones,
- total efectivo,
- total transferencia,
- neto Bomberos,
- saldo cobrador,
- firmas.

### 35.3. Constancia de pago

Debe incluir:

- bono,
- número base,
- número asociado,
- comprador,
- cobrador,
- cuota pagada,
- fecha de venta,
- importe total del bono,
- monto pagado,
- medio de pago,
- comisión asociada,
- fecha de pago.

---

## 36. Copias de seguridad

El sistema debe contar con mecanismos de respaldo.

Tipos de respaldo recomendados:

1. Backup automático de base de datos.
2. Exportaciones periódicas.
3. Descarga manual de reportes.
4. Respaldo de documentos generados.

Como la aplicación se montará en AWS, se recomienda:

- base de datos PostgreSQL en Amazon RDS,
- backups automáticos de RDS,
- snapshots,
- exportaciones a S3,
- versionado de archivos en S3,
- políticas de retención.

---

## 37. Reglas de negocio consolidadas

1. Una campaña contiene todos los bonos, sorteos, ventas, pagos y rendiciones de un período anual.
2. Un bono puede ser simple o pata.
3. Un bono simple tiene un número base y un número asociado calculado.
4. El número asociado se calcula sumando 4871 al número base.
5. Una pata es un bono con varios números base.
6. Cada número base de una pata genera su número asociado.
7. Un comprador participa con todos los números participantes del bono comprado.
8. Si sale sorteado el número base o el asociado, el ganador es el mismo bono.
9. No debe haber números participantes duplicados dentro de una campaña.
10. Los compradores suelen intentar conservar su número histórico.
11. Si un número histórico queda dentro de una pata, se asigna otro número alternativo.
12. Los bonos se entregan primero a cobradores antes de venderse.
13. La entrega al cobrador debe generar remito.
14. Una venta asocia bono, comprador y cobrador.
15. Los pagos pueden ser de contado, por cuota o adelantados.
16. Los pagos pueden ser en efectivo o transferencia.
17. Las transferencias van directo a Bomberos.
18. Las transferencias generan comisión a favor del cobrador.
19. Las comisiones pueden acumularse y liquidarse después.
20. Las reglas de comisión deben ser configurables por campaña.
21. Para participar en un sorteo mensual deben estar pagas la cuota del mes y todas las anteriores.
22. La elegibilidad debe calcularse con una fecha de corte.
23. El padrón del sorteo debe quedar congelado.
24. Si un bono no estaba habilitado al momento del sorteo, no corresponde entregar premio.
25. El sorteo extraordinario requiere pago total antes de la fecha límite.
26. El código de barras debe usarse como ayuda, pero no como única clave del sistema hasta confirmar su significado.
27. No se debe borrar historial; se debe anular o corregir con auditoría.
28. El sistema debe reemplazar el control manual actual en Excel.

---

## 38. Dudas pendientes a confirmar

Antes de pasar al diseño técnico definitivo, quedan pendientes estas definiciones:

1. ¿Qué ocurre si `número_base + 4871` supera 9999?
2. ¿El valor de una pata siempre es proporcional al valor del bono simple?
3. ¿Los números extra del sorteo extraordinario se calculan por cantidad de números base o por otra regla?
4. ¿El sorteo final requiere estar completamente pago o solo al día?
5. ¿Los sorteos consuelo tienen la misma regla de elegibilidad que los mensuales?
6. ¿Qué información exacta contiene el código de barras?
7. ¿Se permitirá acceso directo a cobradores o todo será operado por administración?
8. ¿Qué datos legales/fiscales se desean registrar de compradores empresas?
9. ¿Qué ocurre con bonos no vendidos al cierre de campaña?
10. ¿Qué procedimiento formal existe para premios no adjudicados por falta de pago?

---

## 39. Próximo paso recomendado

A partir de este modelo de negocio, el siguiente paso debería ser armar el diseño funcional del sistema.

Orden recomendado:

1. Definir módulos del sistema.
2. Definir pantallas principales.
3. Definir flujos de usuario.
4. Definir estados y transiciones.
5. Armar el modelo DER.
6. Definir endpoints/API.
7. Armar tasklist de implementación.
8. Priorizar MVP.
9. Diseñar infraestructura AWS.
10. Implementar backend, frontend y base de datos.
