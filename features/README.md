# Funcionalidades y flujos de valor agregado — Sistema de Gestión de Rifas / Bonos de Bomberos

## 1. Objetivo del documento

Este documento registra funcionalidades, procesos y mejoras propuestas para que el nuevo sistema de rifas no sea solamente un reemplazo del sistema actual, sino una mejora integral del flujo operativo, administrativo y financiero de Bomberos.

La idea es que este documento sirva como base para:

1. Diseñar módulos funcionales.
2. Diseñar pantallas y flujos de usuario.
3. Definir el alcance del MVP.
4. Priorizar funcionalidades.
5. Armar una tasklist técnica de implementación.
6. Mejorar procesos actuales que hoy se realizan manualmente o en Excel.

---

## 2. Enfoque general

El sistema no debería limitarse a cargar bonos, compradores y pagos.

El valor real está en permitir que Bomberos pueda saber en todo momento:

```text
Quién tiene cada bono.
Quién lo compró.
Qué números participan.
Qué pagó.
Qué debe.
Qué cobrador intervino.
Qué comisión corresponde.
Qué dinero entró.
Qué dinero falta.
Quién puede participar en el próximo sorteo.
Quién no puede participar por deuda.
Qué premios fueron entregados.
Qué rendiciones están pendientes.
Qué transferencias están sin identificar.
```

El sistema debería convertirse en una herramienta de gestión y control, no solamente en una base de datos.

---

# 3. Flujo de preventa con reservas históricas

Actualmente se intenta asignar a cada cobrador los mismos números que el año anterior, porque muchos compradores quieren conservar su número habitual.

Esto debería transformarse en un flujo formal del sistema.

## 3.1. Flujo propuesto

```text
Campaña anterior cerrada
↓
Sistema detecta compradores históricos
↓
Sistema propone reservar los mismos números
↓
Administrador revisa disponibilidad y conflictos
↓
Sistema asigna números/bonos al cobrador correspondiente
```

## 3.2. Caso exitoso

```text
Comprador: Diego Fernández
Número habitual: 0068
Cobrador habitual: Juan Pérez

Nueva campaña:
Número 0068 disponible

Acción:
Reservar/asignar número al mismo cobrador
```

## 3.3. Caso con conflicto

```text
Comprador: Diego Fernández
Número habitual: 0068
Cobrador habitual: Juan Pérez

Nueva campaña:
Número 0068 pertenece a una pata

Acción:
Marcar conflicto y sugerir número alternativo
```

## 3.4. Valor agregado

- Reduce trabajo manual.
- Reduce errores de asignación.
- Mejora la continuidad comercial.
- Evita discusiones con compradores.
- Le da al cobrador una cartera inicial de compradores esperados.
- Permite medir renovación de compradores año a año.

---

# 4. Gestión de conflictos de números

Cuando un número histórico ya no está disponible, el sistema debería registrar el conflicto formalmente.

## 4.1. Ejemplo de conflicto

```text
Conflicto N° 00034

Comprador histórico: Diego Fernández
Número solicitado: 0068
Motivo: el número está incluido en una pata
Cobrador habitual: Juan Pérez
Campaña: 2025-2026
```

## 4.2. Acciones posibles

- Asignar número alternativo.
- Mantener comprador en lista de espera.
- Ofrecerle comprar la pata completa.
- Marcar comprador como no renovado.
- Registrar observación administrativa.

## 4.3. Valor agregado

- Permite trazabilidad.
- Evita decisiones informales sin registro.
- Permite medir cuántas ventas se pierden o cambian por conflictos.
- Ayuda a planificar mejor la impresión de bonos/patas en campañas futuras.

---

# 5. Lista de renovación de compradores

Cada cobrador debería tener una lista de compradores históricos a contactar.

## 5.1. Ejemplo

```text
Cobrador: Juan Pérez

Clientes a renovar:
1. Diego Fernández - Número 0068 - Pendiente de contacto
2. María López - Número 0120 - Confirmó renovación
3. Ferretería Mitre - Pata 1200 - Pendiente
```

## 5.2. Estados sugeridos

```text
Pendiente de contactar
Contactado
Acepta renovar
No renueva
Pidió cambio de número
Pidió pagar contado
Pendiente de pago
Vendido
```

## 5.3. Valor agregado

- Ordena la preventa.
- Permite medir tasa de renovación.
- Permite saber qué cobrador está gestionando mejor su cartera.
- Reduce pérdida de compradores habituales.
- Permite anticipar demanda antes de entregar todos los bonos.

---

# 6. Panel de cobrador

Aunque inicialmente todo podría ser operado por administración, a futuro cada cobrador podría tener acceso a su propio panel.

## 6.1. Información disponible para el cobrador

- Bonos asignados.
- Bonos vendidos.
- Bonos pendientes de venta.
- Compradores históricos.
- Compradores con cuotas vencidas.
- Cuotas pendientes.
- Cuotas próximas a vencer.
- Pagos por transferencia registrados.
- Rendiciones realizadas.
- Comisión generada.
- Comisión liquidada.
- Saldo a favor o en contra.

## 6.2. Valor agregado

- Reduce consultas a administración.
- Ordena el trabajo del cobrador.
- Mejora el seguimiento de deuda.
- Permite detectar cuotas vencidas antes de los sorteos.
- Mejora la transparencia de comisiones.

---

# 7. Carga rápida por escaneo

El sistema debería aprovechar código de barras o QR para acelerar la operatoria.

Actualmente el código de barras existe en el bono, pero no está confirmado qué dato contiene ni funciona correctamente en el sistema viejo.

## 7.1. Flujo ideal

```text
Administrador escanea bono
↓
Sistema abre la ficha del bono
↓
Permite registrar venta, pago o rendición
```

## 7.2. Flujo para rendición

```text
Crear rendición
↓
Escanear bono
↓
Seleccionar cuota pagada
↓
Elegir medio de pago
↓
Agregar pago a la rendición
```

## 7.3. Recomendación

El sistema nuevo debería guardar:

- número base,
- número asociado calculado,
- código de barras impreso, si existe,
- identificador interno propio del sistema.

Para futuras campañas se recomienda generar un QR propio del sistema.

## 7.4. Valor agregado

- Menos tipeo.
- Menos errores de carga.
- Mayor velocidad en rendiciones.
- Mejor experiencia para administración.
- Base para automatizar futuras campañas.

---

# 8. Rendición asistida

La rendición del cobrador debería ser un flujo central del sistema, no una simple carga de pagos.

## 8.1. Flujo propuesto

```text
Crear rendición
↓
Seleccionar cobrador
↓
Escanear o buscar bonos
↓
Agregar cuotas/pagos
↓
Separar efectivo y transferencia
↓
Calcular comisión automáticamente
↓
Calcular neto para Bomberos
↓
Calcular saldo a favor del cobrador
↓
Confirmar rendición
↓
Imprimir remito
```

## 8.2. Resumen en tiempo real

Durante la carga, la pantalla debería mostrar:

```text
Total efectivo: $...
Total transferencia: $...
Total cobrado: $...
Comisión generada: $...
Comisión liquidada ahora: $...
Saldo a favor del cobrador: $...
Neto para Bomberos: $...
```

## 8.3. Valor agregado

- Reemplaza el Excel actual.
- Reduce errores de cálculo.
- Ordena la relación con el cobrador.
- Permite emitir remitos claros.
- Permite cerrar caja con mayor precisión.

---

# 9. Cuenta corriente del cobrador

Cada cobrador debería tener una cuenta corriente administrativa interna.

No representa necesariamente una cuenta bancaria. Representa el saldo entre Bomberos y el cobrador.

## 9.1. Movimientos posibles

- Comisión generada por pago en efectivo.
- Comisión generada por transferencia.
- Comisión liquidada/pagada.
- Efectivo entregado por el cobrador.
- Ajustes manuales autorizados.
- Anulaciones.
- Correcciones auditadas.
- Saldo a favor del cobrador.
- Saldo a favor de Bomberos.

## 9.2. Ejemplo con transferencia

```text
Comprador paga por transferencia: $6.000
Bomberos recibe: $6.000
Comisión generada para cobrador: $1.500

Movimiento:
Saldo a favor del cobrador +$1.500
```

## 9.3. Ejemplo con efectivo

```text
Comprador paga en efectivo: $6.000
Comisión generada: $1.500
Neto Bomberos: $4.500
```

## 9.4. Valor agregado

- Evita discusiones sobre comisiones.
- Permite acumular comisiones.
- Permite liquidarlas posteriormente.
- Permite controlar transferencias.
- Da transparencia al cobrador y a administración.

---

# 10. Control de pagos por transferencia

Como los pagos por transferencia van directo a Bomberos, el sistema debe tener un flujo específico.

## 10.1. Flujo propuesto

```text
Comprador transfiere a Bomberos
↓
Administración registra la transferencia
↓
Sistema la asocia a comprador, bono y cuota
↓
Sistema marca la cuota como pagada
↓
Sistema genera comisión a favor del cobrador
```

## 10.2. Problema habitual

Puede ocurrir que una transferencia llegue sin información clara.

Ejemplo:

```text
Fecha: 10/11/2025
Importe: $6.000
Referencia: Diego F.
Estado: sin identificar
```

## 10.3. Bandeja de transferencias sin identificar

El sistema debería tener una sección específica para transferencias pendientes.

El sistema podría sugerir coincidencias:

```text
Sugerencias:
1. Diego Fernández - Bono 0068 - Cuota 2
2. Diego Fernández - Bono 1658 - Cuota 2
```

## 10.4. Valor agregado

- Evita pagos perdidos.
- Mejora conciliación.
- Ordena el saldo de los cobradores.
- Reduce errores al marcar cuotas como pagadas.
- Permite preparar conciliación bancaria futura.

---

# 11. Conciliación bancaria semi-automática

Funcionalidad avanzada, no necesariamente para el MVP inicial.

## 11.1. Flujo propuesto

```text
Administración descarga movimientos bancarios
↓
Importa archivo al sistema
↓
Sistema detecta posibles coincidencias
↓
Administrador confirma o corrige
↓
Pagos quedan asociados a cuotas
```

## 11.2. Criterios de coincidencia

- Importe exacto.
- Nombre o referencia.
- Fecha.
- Comprador.
- Teléfono.
- Bono asociado.
- Cuota esperada.
- Cobrador asignado.

## 11.3. Valor agregado

- Ahorra tiempo administrativo.
- Reduce transferencias sin identificar.
- Mejora control financiero.
- Permite escalar si aumenta el uso de transferencias.

---

# 12. Alertas de cuotas vencidas

El sistema debería detectar automáticamente cuotas vencidas.

## 12.1. Ejemplo

```text
Bono: 1658
Comprador: Diego Fernández
Cobrador: Juan Pérez
Cuota vencida: cuota 3
Días de atraso: 12
```

## 12.2. Vistas útiles

- Cuotas vencidas por cobrador.
- Cuotas vencidas por comprador.
- Bonos en riesgo de no participar en el próximo sorteo.
- Bonos con varias cuotas vencidas.
- Compradores reincidentes.

## 12.3. Valor agregado

- Permite accionar antes del sorteo.
- Reduce morosidad.
- Mejora la recaudación.
- Ayuda al cobrador a priorizar visitas/contactos.

---

# 13. Alertas antes de cada sorteo

Antes de cada sorteo mensual, el sistema debería mostrar una alerta operativa.

## 13.1. Ejemplo

```text
Sorteo: Diciembre 2025
Cuota requerida: 3
Fecha de corte: 26/12/2025

Bonos habilitados: 1340
Bonos no habilitados: 210
Bonos con deuda salvable: 95
```

## 13.2. Concepto de deuda salvable

Bonos que no están habilitados actualmente, pero podrían quedar habilitados si pagan antes del corte.

Ejemplo:

```text
Bono 1658
Debe cuota 3
Si paga antes del corte, participa del sorteo.
```

## 13.3. Valor agregado

- Permite avisar a compradores.
- Permite priorizar cobranzas.
- Reduce reclamos posteriores.
- Mejora la recaudación antes de sorteos.

---

# 14. Padrón congelado de sorteos

El padrón de participantes habilitados debe generarse antes de cada sorteo y quedar congelado.

## 14.1. Flujo propuesto

```text
Generar padrón
↓
Sistema calcula habilitados/no habilitados
↓
Administrador revisa
↓
Se congela padrón
↓
Se realiza sorteo
↓
Se cargan ganadores
```

## 14.2. Por qué debe congelarse

No debe recalcularse dinámicamente después del sorteo, porque alguien podría pagar tarde y parecer habilitado en el sistema aunque no lo estuviera al momento del sorteo.

## 14.3. Valor agregado

- Transparencia.
- Trazabilidad.
- Evita reclamos.
- Permite justificar premios no adjudicados.
- Mejora control legal/administrativo.

---

# 15. Simulador / validador de ganador

Cuando se carga un número ganador, el sistema debería explicar claramente el resultado.

## 15.1. Ejemplo

```text
Número ganador: 6529

Coincide con:
Bono: 1658
Número ganador: asociado
Número base: 1658
Comprador: Diego Fernández
Cobrador: Juan Pérez

Estado en padrón:
No habilitado

Motivo:
Cuota 3 impaga al momento del corte

Resultado:
Premio no adjudicado
```

## 15.2. Valor agregado

- Evita interpretaciones manuales.
- Reduce errores al asignar premios.
- Facilita explicar decisiones.
- Permite auditar resultados.

---

# 16. Control de premios entregados

No alcanza con registrar el número ganador. Hay que registrar el ciclo completo del premio.

## 16.1. Flujo de premio entregado

```text
Premio sorteado
↓
Ganador identificado
↓
Ganador habilitado
↓
Premio pendiente de entrega
↓
Premio entregado
```

## 16.2. Flujo de premio no adjudicado

```text
Premio sorteado
↓
Ganador identificado
↓
Ganador no habilitado
↓
Premio no adjudicado
↓
Observación administrativa
```

## 16.3. Datos a registrar

- sorteo,
- premio,
- número ganador,
- bono asociado,
- comprador,
- cobrador,
- estado de habilitación,
- fecha de entrega,
- usuario que registra,
- comprobante o constancia,
- observaciones.

## 16.4. Valor agregado

- Controla premios pendientes.
- Evita olvidos.
- Permite reportes de premios entregados/no entregados.
- Mejora transparencia institucional.

---

# 17. Ficha única del bono

Cada bono debería tener una ficha central, como un expediente completo.

## 17.1. Información sugerida

```text
Bono 1658

Campaña: 2025-2026
Tipo: Simple
Número base: 1658
Número asociado: 6529
Estado comercial: Vendido
Estado financiero: Al día
Cobrador: Juan Pérez
Comprador: Diego Fernández
```

## 17.2. Secciones de la ficha

- Datos generales.
- Números participantes.
- Cobrador asignado.
- Comprador.
- Cuotas.
- Pagos.
- Rendiciones.
- Comisiones generadas.
- Sorteos en los que participó.
- Estado de habilitación por sorteo.
- Premios.
- Historial/auditoría.

## 17.3. Valor agregado

- Ahorra tiempo de búsqueda.
- Centraliza toda la información.
- Permite resolver reclamos rápidamente.
- Facilita auditoría.

---

# 18. Ficha única del comprador

El comprador debería tener historial completo.

## 18.1. Información sugerida

```text
Comprador: Diego Fernández

Campañas:
2023-2024: Bono 0068
2024-2025: Bono 0068
2025-2026: Bono 1658

Cobrador habitual:
Juan Pérez

Estado actual:
Cuota 1 paga
Cuota 2 paga
Cuota 3 pendiente
```

## 18.2. Valor agregado

- Permite saber si es comprador recurrente.
- Permite ver números habituales.
- Permite detectar deudas.
- Permite mejorar la atención.
- Ayuda en la renovación anual.

---

# 19. Ficha única del cobrador

El cobrador debería tener una vista integral.

## 19.1. Información sugerida

```text
Cobrador: Juan Pérez

Bonos asignados: 120
Vendidos: 85
Pendientes de venta: 35
Cuotas al día: 60
Cuotas atrasadas: 25
Total cobrado: $...
Total rendido: $...
Comisión generada: $...
Comisión liquidada: $...
Saldo actual: $...
```

## 19.2. Indicadores útiles

- porcentaje de venta,
- porcentaje de cobranza,
- deuda total de su cartera,
- cantidad de compradores atrasados,
- bonos no vendidos,
- comisiones pendientes,
- transferencias asociadas.

## 19.3. Valor agregado

- Permite gestionar mejor cobradores.
- Reduce incertidumbre sobre saldos.
- Permite detectar bajo desempeño o problemas operativos.
- Mejora la planificación de cobranzas.

---

# 20. Ranking y seguimiento de cobradores

El sistema podría generar rankings operativos.

## 20.1. Indicadores posibles

- Cobradores con mayor venta.
- Cobradores con mayor cobranza al día.
- Cobradores con más deuda vencida.
- Cobradores con más bonos sin vender.
- Cobradores con mayor cantidad de transferencias.
- Cobradores con saldo pendiente de comisión.

## 20.2. Uso recomendado

No debería utilizarse como herramienta punitiva, sino como control operativo y apoyo a la gestión.

## 20.3. Valor agregado

- Detecta cobradores que necesitan ayuda.
- Identifica zonas o carteras con baja cobranza.
- Permite tomar decisiones antes del cierre de campaña.

---

# 21. Workflow de devolución de bonos

No todos los bonos asignados se venden. Debe existir un flujo claro para devolución.

## 21.1. Flujo simple

```text
Cobrador devuelve bono
↓
Administración recibe
↓
Bono vuelve a disponible
```

## 21.2. Flujo con reasignación

```text
Cobrador devuelve bono
↓
Administración recibe
↓
Bono se reasigna a otro cobrador
```

## 21.3. Estados posibles

```text
Disponible
Asignado a cobrador
Vendido
Devuelto
Reasignado
Extraviado
Anulado
```

## 21.4. Valor agregado

- Control físico de bonos.
- Evita perder cartones.
- Permite reasignar rápidamente bonos no vendidos.
- Mantiene trazabilidad.

---

# 22. Control de bonos extraviados

Debe existir un proceso para bonos perdidos o extraviados.

## 22.1. Datos a registrar

- bono,
- cobrador responsable,
- fecha,
- motivo,
- observación,
- usuario que registra,
- estado posterior,
- si se anula,
- si se reemplaza,
- si se informa formalmente.

## 22.2. Valor agregado

- Mejora control físico.
- Evita que bonos extraviados sigan circulando sin control.
- Deja responsabilidad y trazabilidad.
- Ayuda ante reclamos.

---

# 23. Armado inteligente de patas

Cuando no quedan patas impresas y se quieren agrupar bonos simples, el sistema debería asistir la creación.

## 23.1. Flujo propuesto

```text
Crear nueva pata
↓
Definir cantidad de unidades
↓
Sistema busca bonos disponibles
↓
Sistema advierte conflictos
↓
Administrador confirma agrupación
```

## 23.2. Criterios de sugerencia

El sistema debería sugerir bonos que:

- estén disponibles,
- no estén vendidos,
- no estén asignados,
- no tengan reserva histórica activa,
- no estén comprometidos con un cobrador,
- no tengan conflictos de número.

## 23.3. Valor agregado

- Evita romper reservas históricas.
- Evita agrupar bonos comprometidos.
- Reduce errores administrativos.
- Facilita ventas grandes a empresas.

---

# 24. Trazabilidad de patas

Cada pata debería mostrar claramente su composición.

## 24.1. Ejemplo

```text
Pata 1200

Números base:
1200, 1315, 2200, 3100, 4500

Números asociados:
6071, 6186, 7071, 7971, 9371

Origen:
Impresa

Comprador:
Empresa X

Cobrador:
Juan Pérez
```

## 24.2. Si fue armada manualmente

```text
Origen:
Armada manualmente

Bonos simples que la componen:
- Bono 1200
- Bono 1315
- Bono 2200
- Bono 3100
- Bono 4500
```

## 24.3. Valor agregado

- Claridad comercial.
- Claridad en sorteos.
- Mejor trazabilidad.
- Menos confusión al vender varios números.

---

# 25. Dashboard general de campaña

La administración debería tener una pantalla principal con indicadores.

## 25.1. Indicadores sugeridos

```text
Campaña 2025-2026

Bonos totales: 3000
Bonos vendidos: 1850
Bonos disponibles: 600
Bonos en cobradores sin vender: 550

Recaudación esperada: $...
Recaudado real: $...
Pendiente: $...

Efectivo: $...
Transferencia: $...

Comisiones generadas: $...
Comisiones liquidadas: $...
Saldo pendiente cobradores: $...

Próximo sorteo:
Diciembre 2025
Bonos habilitados: 1430
Bonos en riesgo: 220
```

## 25.2. Valor agregado

- Permite tener una visión global.
- Ayuda a tomar decisiones.
- Muestra problemas antes de que sean graves.
- Convierte el sistema en herramienta de gestión.

---

# 26. Flujo de cierre mensual

Cada mes debería poder cerrarse operativamente.

## 26.1. Flujo propuesto

```text
Cierre mensual
↓
Validar rendiciones pendientes
↓
Validar transferencias sin asociar
↓
Validar cuotas vencidas
↓
Generar padrón del sorteo
↓
Emitir reportes
↓
Cerrar mes
```

## 26.2. Validaciones previas

Antes de cerrar el mes, el sistema debería advertir:

- rendiciones abiertas,
- transferencias sin identificar,
- pagos sin asociar,
- cuotas vencidas,
- bonos vendidos sin comprador completo,
- cobradores con saldo inconsistente,
- premios pendientes de registro.

## 26.3. Valor agregado

- Orden administrativo.
- Evita llegar al sorteo con información incompleta.
- Permite auditar cada mes.
- Mejora la disciplina operativa.

---

# 27. Reporte de riesgo antes del sorteo

Antes de cada sorteo, el sistema debería generar un reporte de bonos en riesgo.

## 27.1. Criterio

Bonos vendidos que tienen cuotas pendientes necesarias para participar del próximo sorteo.

## 27.2. Ejemplo

```text
Próximo sorteo: Diciembre 2025
Cuota requerida: 3

Cobrador Juan Pérez:
- Diego Fernández - Bono 1658 - debe cuota 3
- María López - Bono 0100 - debe cuotas 2 y 3
```

## 27.3. Valor agregado

- Permite accionar antes del corte.
- Ayuda al cobrador a priorizar.
- Reduce premios no adjudicados por falta de pago.
- Mejora la recaudación.

---

# 28. Notificaciones

Funcionalidad futura con mucho valor.

## 28.1. Notificaciones a compradores

Ejemplo:

```text
Hola Diego, te recordamos que la cuota 3 del Bono 1658 vence el 25/12.
Para participar del sorteo de diciembre tenés que tener las cuotas al día.
```

## 28.2. Notificaciones a cobradores

Ejemplo:

```text
Tenés 18 compradores con cuotas pendientes antes del sorteo de diciembre.
```

## 28.3. Notificaciones a administración

Ejemplo:

```text
Hay 12 transferencias sin identificar.
```

## 28.4. Canales posibles

- WhatsApp.
- Email.
- SMS.
- Notificación interna del sistema.

## 28.5. Valor agregado

- Reduce morosidad.
- Automatiza recordatorios.
- Mejora comunicación.
- Ayuda a prevenir reclamos.

---

# 29. Portal o consulta para comprador

A futuro, el comprador podría consultar su bono.

## 29.1. Opción simple

```text
Consultar bono
Ingresar número de bono + teléfono o DNI
```

## 29.2. Información visible

- datos del bono,
- números participantes,
- cuotas pagas,
- cuotas pendientes,
- próximos sorteos,
- estado de participación,
- comprobantes,
- medios de pago.

## 29.3. Valor agregado

- Reduce consultas a administración.
- Aumenta transparencia.
- Mejora experiencia del comprador.
- Permite comprobar pagos.

---

# 30. Recibos digitales

Además del recibo físico, el sistema debería poder emitir recibos digitales.

## 30.1. Datos mínimos

- campaña,
- bono,
- número base,
- número asociado,
- comprador,
- cobrador,
- cuota,
- importe,
- fecha,
- medio de pago,
- número de operación,
- usuario que registró,
- código de validación o QR.

## 30.2. Valor agregado

- Reduce reclamos.
- Permite reenviar comprobantes.
- Deja historial claro.
- Moderniza la operatoria.

---

# 31. QR en futuros bonos

Para futuras campañas, se recomienda imprimir QR propios generados por el sistema.

## 31.1. Ejemplo de contenido

```text
BONO-2025-2026-1658
```

O un identificador interno seguro.

## 31.2. Usos del QR

- abrir ficha del bono,
- registrar venta,
- registrar pago,
- incluir en rendición,
- permitir consulta del comprador,
- validar recibos digitales.

## 31.3. Valor agregado

- Independencia del código de barras viejo.
- Mejor integración con la app.
- Mayor velocidad operativa.
- Base para portal de compradores/cobradores.

---

# 32. Gestión de anulaciones y correcciones

El sistema debe asumir que habrá errores, pero no debe permitir borrar información histórica sin registro.

## 32.1. Ejemplo de anulación de pago

```text
Pago registrado por error
↓
Usuario solicita anulación
↓
Sistema exige motivo
↓
Sistema revierte cuota, comisión y rendición
↓
Queda todo auditado
```

## 32.2. Casos a contemplar

- pago mal cargado,
- venta mal cargada,
- comprador incorrecto,
- cobrador incorrecto,
- bono asignado por error,
- transferencia mal asociada,
- premio mal cargado,
- pata mal agrupada.

## 32.3. Valor agregado

- Evita pérdida de historial.
- Mejora auditoría.
- Permite corregir sin romper datos.
- Da confianza al sistema.

---

# 33. Modo “jornada de rendición”

Cuando varios cobradores van a rendir el mismo día, administración podría abrir una jornada de rendiciones.

## 33.1. Flujo propuesto

```text
Nueva jornada de rendiciones
Fecha: 10/10/2025
↓
Rendición Juan Pérez
Rendición María Gómez
Rendición Carlos Díaz
↓
Cierre de jornada
```

## 33.2. Resumen de jornada

```text
Total efectivo recibido
Total transferencias registradas
Comisiones generadas
Comisiones liquidadas
Neto Bomberos
Diferencias de caja
Cantidad de rendiciones
```

## 33.3. Valor agregado

- Ordena días de alta carga administrativa.
- Permite cierre diario.
- Facilita conciliación con caja.
- Reemplaza controles manuales.

---

# 34. Caja diaria de Bomberos

Además de rendiciones individuales, conviene manejar una caja diaria.

## 34.1. Ingresos

- efectivo por rendiciones,
- transferencias,
- otros ingresos vinculados.

## 34.2. Egresos

- comisiones pagadas,
- ajustes,
- otros egresos autorizados.

## 34.3. Cierre de caja

```text
Saldo esperado
Saldo contado
Diferencia
Observaciones
Usuario responsable
```

## 34.4. Valor agregado

- Mayor control financiero.
- Mejor trazabilidad del efectivo.
- Permite detectar diferencias.
- Facilita reportes administrativos.

---

# 35. Indicadores de campaña

El sistema debería generar indicadores para gestión.

## 35.1. Indicadores sugeridos

```text
% de bonos vendidos
% de recaudación real vs esperada
% de morosidad
% de renovación de compradores
% de pagos por transferencia
% de pagos en efectivo
Comisión total generada
Comisión total liquidada
Saldo pendiente de comisiones
Bonos con riesgo para próximo sorteo
Cobradores con mayor deuda pendiente
Patas vendidas
Bonos no vendidos
Compradores perdidos respecto al año anterior
```

## 35.2. Valor agregado

- Permite tomar decisiones basadas en datos.
- Ayuda a mejorar futuras campañas.
- Permite informar a la comisión directiva.
- Mejora planificación.

---

# 36. Flujo de cierre de campaña

Al finalizar la campaña, debería existir un cierre formal.

## 36.1. Flujo propuesto

```text
Cerrar campaña
↓
Validar sorteos finalizados
↓
Validar premios pendientes
↓
Validar rendiciones abiertas
↓
Validar bonos no devueltos
↓
Validar saldos de cobradores
↓
Generar reporte final
↓
Bloquear modificaciones
```

## 36.2. Reglas posteriores al cierre

Después del cierre:

- no se deberían permitir cambios normales,
- solo administradores podrían hacer correcciones auditadas,
- los datos deberían quedar disponibles como histórico,
- deberían servir como base para la nueva campaña.

## 36.3. Valor agregado

- Ordena el final del período.
- Evita modificaciones tardías sin control.
- Permite iniciar mejor la próxima campaña.
- Genera trazabilidad institucional.

---

# 37. Reporte final de campaña

Al cerrar la campaña, el sistema debería generar un reporte final.

## 37.1. Contenido sugerido

```text
Campaña 2025-2026

Bonos emitidos
Bonos vendidos
Bonos no vendidos
Patas vendidas
Recaudación bruta
Recaudación neta
Comisiones generadas
Comisiones liquidadas
Saldos pendientes
Premios entregados
Premios no adjudicados
Deuda pendiente
Compradores renovados
Compradores perdidos
Cobradores destacados
```

## 37.2. Valor agregado

- Útil para administración.
- Útil para comisión directiva.
- Útil para planificación futura.
- Permite comparar campañas.

---

# 38. Importación masiva de bonos

Cuando llegan los bonos impresos, no deberían cargarse uno por uno.

## 38.1. Archivo de ejemplo

```csv
tipo_bono,grupo_pata,numero_base,barcode
simple,,1658,1658
simple,,0068,0068
pata,PATA1200,1200,PATA1200
pata,PATA1200,1315,PATA1200
pata,PATA1200,2200,PATA1200
```

## 38.2. Validaciones

El sistema debe validar:

- números duplicados,
- números asociados duplicados,
- números fuera de rango,
- patas incompletas,
- códigos de barra repetidos,
- conflictos con reservas históricas,
- formato inválido.

## 38.3. Vista previa antes de confirmar

```text
Bonos simples a crear: 3000
Patas a crear: 120
Conflictos detectados: 8
Duplicados detectados: 2
```

## 38.4. Valor agregado

- Ahorra tiempo de carga.
- Reduce errores.
- Permite validar antes de impactar datos.
- Escala mejor con campañas grandes.

---

# 39. Importación desde campaña anterior

Al crear una campaña nueva, el sistema debería poder usar la anterior como base.

## 39.1. Datos que puede copiar o sugerir

- cobradores,
- compradores históricos,
- números habituales,
- configuración de cuotas,
- configuración de comisiones,
- tipos de sorteos,
- estructura de premios,
- reglas de elegibilidad.

## 39.2. Flujo propuesto

```text
Crear campaña 2026-2027 desde campaña 2025-2026
↓
Copiar configuración
↓
Importar nuevos bonos
↓
Cruzar números con historial
↓
Generar reservas y conflictos
```

## 39.3. Valor agregado

- Acelera el inicio anual.
- Reduce carga repetitiva.
- Mejora continuidad comercial.
- Permite detectar conflictos automáticamente.

---

# 40. Validaciones anti-error

El sistema debería prevenir acciones peligrosas o inconsistentes.

## 40.1. Ejemplos

```text
Este bono ya fue vendido. No puede reasignarse.
```

```text
Este número participante ya existe en otro bono.
```

```text
Está intentando registrar la cuota 4, pero la cuota 3 sigue impaga.
¿Desea registrarla como pago adelantado o corregir?
```

```text
Este comprador tiene deuda anterior.
```

```text
Este pago por transferencia todavía no fue conciliado.
```

```text
Este bono no entra al sorteo extraordinario porque pagó completo después de la fecha límite.
```

## 40.2. Valor agregado

- Reduce errores humanos.
- Protege la consistencia del sistema.
- Mejora la confianza en los datos.
- Evita reclamos futuros.

---

# 41. Módulos funcionales sugeridos

A partir de las mejoras anteriores, los módulos funcionales podrían ser:

1. Campañas.
2. Bonos y patas.
3. Importaciones.
4. Compradores.
5. Cobradores.
6. Reservas históricas.
7. Entregas de bonos.
8. Ventas.
9. Pagos.
10. Rendiciones.
11. Comisiones.
12. Cuenta corriente de cobradores.
13. Transferencias.
14. Caja diaria.
15. Sorteos.
16. Padrones.
17. Premios.
18. Reportes.
19. Auditoría.
20. Usuarios y permisos.
21. Notificaciones.
22. Portal de cobrador.
23. Portal de comprador.

---

# 42. Priorización por MVP

No conviene implementar todo desde el inicio. Se propone dividir en etapas.

---

## MVP 1 — Control operativo básico real

Objetivo: reemplazar el sistema actual y el Excel principal.

Funcionalidades:

- Campañas.
- Bonos simples y patas.
- Número base + número asociado.
- Cobradores.
- Compradores.
- Asignación de bonos a cobradores.
- Remito de entrega.
- Venta de bonos.
- Cuotas.
- Pagos.
- Rendiciones.
- Comisiones básicas.
- Cuenta corriente simple del cobrador.
- Reporte por cobrador.
- Remito de rendición.
- Auditoría básica.

---

## MVP 2 — Sorteos y elegibilidad

Objetivo: controlar participación y premios.

Funcionalidades:

- Sorteos mensuales.
- Sorteo extraordinario.
- Sorteos consuelo.
- Sorteo final.
- Padrón congelado.
- Validación de habilitados.
- Carga de números ganadores.
- Validación de premio.
- Registro de premios entregados/no adjudicados.
- Reporte de habilitados/no habilitados.

---

## MVP 3 — Optimización operativa

Objetivo: reducir carga manual y mejorar seguimiento.

Funcionalidades:

- Escaneo de código de barras.
- QR interno.
- Importación masiva de bonos.
- Importación desde campaña anterior.
- Reservas históricas.
- Gestión de conflictos de números.
- Alertas de vencimiento.
- Dashboard de campaña.
- Reporte de riesgo antes del sorteo.
- Transferencias sin identificar.

---

## MVP 4 — Digitalización avanzada

Objetivo: mejorar comunicación y autoservicio.

Funcionalidades:

- Portal del cobrador.
- Portal del comprador.
- Recibos digitales.
- Notificaciones por WhatsApp/email/SMS.
- Conciliación bancaria semi-automática.
- Caja diaria avanzada.
- Indicadores comparativos entre campañas.

---

# 43. Flujos críticos para comenzar el diseño

Antes de diseñar pantallas CRUD, conviene diseñar estos flujos completos:

1. Crear campaña.
2. Importar/cargar bonos.
3. Calcular números asociados.
4. Detectar duplicados/conflictos.
5. Asignar bonos a cobradores.
6. Emitir remito de entrega.
7. Registrar venta.
8. Registrar comprador.
9. Registrar pago.
10. Crear rendición.
11. Calcular comisión.
12. Actualizar cuenta corriente del cobrador.
13. Emitir remito de rendición.
14. Generar resumen mensual por cobrador.
15. Generar padrón de sorteo.
16. Cargar número ganador.
17. Validar premio.
18. Cerrar mes.
19. Cerrar campaña.

---

# 44. Recomendación final

La mejora más importante no está en digitalizar exactamente el proceso viejo, sino en rediseñarlo para tener trazabilidad, control y automatización.

El sistema debería evitar convertirse en un conjunto de pantallas aisladas.

El corazón del sistema debería ser:

```text
Campaña
↓
Bonos
↓
Cobradores
↓
Compradores
↓
Pagos
↓
Rendiciones
↓
Comisiones
↓
Sorteos
↓
Premios
```

Cada movimiento relevante debe quedar registrado.

Cada decisión importante debe ser auditable.

Cada sorteo debe poder justificarse con un padrón congelado.

Cada cobrador debe tener una cuenta corriente clara.

Cada bono debe tener una ficha única.

Cada comprador debe tener historial.

Ese es el valor agregado principal frente al sistema actual.
