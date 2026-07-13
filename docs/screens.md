# Pantallas y experiencia funcional

## Objetivo

Definir pantallas prioritarias del MVP y dejar una base adaptable para futuras funcionalidades.

## Principios de UI

- Diseñar por flujos operativos, no solo por CRUD.
- Mostrar acciones segun permisos.
- Priorizar busqueda rapida por numero, comprador, cobrador y codigo de barras.
- Mantener fichas unicas para resolver reclamos rapidamente.
- Todas las pantallas clave deben funcionar en desktop y mobile.

## Navegacion principal

Secciones sugeridas:

- Dashboard.
- Campanas.
- Bonos.
- Cobradores.
- Compradores.
- Ventas.
- Rendiciones.
- Sorteos.
- Reportes.
- Administracion.

## Pantallas del MVP

### Dashboard de campana

Objetivo: mostrar estado general de la campana activa.

Debe mostrar:

- Bonos totales, vendidos, disponibles y entregados.
- Recaudacion esperada, cobrada y pendiente.
- Efectivo y transferencias.
- Comisiones generadas y liquidadas.
- Saldos de cobradores.
- Proximo sorteo.
- Bonos en riesgo para el proximo sorteo.

### Bonos

Objetivo: buscar y filtrar bonos.

Filtros:

- Campana.
- Numero base.
- Numero asociado.
- Codigo de barras.
- Tipo: simple o pata.
- Estado comercial.
- Estado financiero.
- Cobrador.
- Comprador.

Acciones:

- Crear bono.
- Crear pata.
- Cargar por codigo de barras.
- Asignar a cobrador.
- Ver ficha.

### Ficha de bono

Objetivo: expediente completo del bono.

Secciones:

- Datos generales.
- Numeros participantes.
- Codigo de barras.
- Cobrador actual.
- Comprador actual.
- Venta.
- Cuotas.
- Pagos.
- Rendiciones.
- Comisiones.
- Sorteos y padrones.
- Premios.
- Auditoria.

### Carga por codigo de barras

Objetivo: acelerar carga o busqueda de bonos fisicos.

Flujo:

```txt
Seleccionar campana
↓
Elegir modo de lectura
↓
Escanear codigo
↓
Sistema interpreta valor
↓
Sistema muestra resultado
↓
Usuario confirma o corrige
```

Modos posibles:

- Codigo representa numero base.
- Codigo representa identificador interno.
- Codigo representa codigo heredado externo.
- Codigo requiere mapeo manual.

### Cobradores

Objetivo: administrar vendedores/cobradores.

Debe mostrar:

- Datos de contacto.
- Bonos asignados.
- Bonos vendidos.
- Deuda de cartera.
- Rendiciones.
- Comisiones.
- Saldo actual.

### Ficha de cobrador

Objetivo: vista integral del cobrador.

Secciones:

- Datos generales.
- Bonos asignados.
- Compradores asociados.
- Cuotas pendientes.
- Rendiciones.
- Cuenta corriente.
- Reporte mensual.
- Auditoria.

### Compradores

Objetivo: gestionar compradores e historial.

Debe permitir:

- Alta/edicion.
- Busqueda por nombre, telefono, documento o CUIT.
- Ver bonos comprados.
- Ver deuda.
- Ver premios.
- Ver numeros historicos si fueron migrados.

### Venta

Objetivo: registrar venta de bono o pata.

Flujo:

```txt
Buscar bono
↓
Validar disponibilidad
↓
Seleccionar o crear comprador
↓
Confirmar cobrador
↓
Elegir modalidad de pago
↓
Generar cuotas
↓
Registrar pago inicial si corresponde
```

### Rendicion asistida

Objetivo: reemplazar el Excel operativo.

Debe mostrar en tiempo real:

- Total efectivo.
- Total transferencia.
- Total general.
- Comision preliminar.
- Comision liquidada ahora.
- Neto para Bomberos.
- Saldo a favor del cobrador.

Acciones:

- Agregar pago.
- Quitar pago de rendicion abierta.
- Ajustar comision con permiso.
- Cerrar rendicion.
- Imprimir remito.

### Cuenta corriente de cobrador

Objetivo: explicar el saldo administrativo.

Debe mostrar:

- Movimientos.
- Tipo.
- Origen.
- Rendicion vinculada.
- Pago vinculado.
- Debe/haber o credito/debito.
- Saldo acumulado.
- Ajustes y anulaciones.

### Sorteos

Objetivo: administrar sorteos de la campana.

Debe permitir:

- Crear sorteo mensual, extraordinario, final o consuelo.
- Configurar fecha y corte.
- Configurar regla de elegibilidad.
- Generar padron.
- Congelar padron.
- Cargar ganadores.

### Padron de sorteo

Objetivo: justificar participantes y no participantes.

Debe mostrar:

- Numero participante.
- Bono.
- Comprador.
- Cobrador.
- Habilitado o no habilitado.
- Motivo de no habilitacion.
- Fecha de generacion y congelamiento.

### Carga de ganador

Objetivo: resolver resultado de sorteo.

Flujo:

```txt
Ingresar numero ganador
↓
Buscar en padron congelado
↓
Mostrar bono, comprador y cobrador
↓
Mostrar estado de habilitacion
↓
Registrar premio adjudicado o no adjudicado
```

### Reportes

Reportes MVP:

- Bonos por estado.
- Bonos por cobrador.
- Cuotas pendientes.
- Pagos por fecha.
- Rendiciones por cobrador.
- Cuenta corriente de cobrador.
- Padron de sorteo.
- Ganadores y premios.
