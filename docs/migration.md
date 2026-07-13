# Migracion de datos

## Objetivo

Definir como incorporar datos del sistema antiguo o planillas existentes al nuevo sistema.

## Datos esperados desde sistema antiguo

El sistema antiguo podria exportar:

- Cobradores/vendedores.
- Compradores.
- Numeros correspondientes a cada comprador.
- Relacion comprador-cobrador.
- Campana anterior.

## Estrategia

La migracion debe pasar por staging antes de impactar tablas definitivas.

```txt
Exportar sistema viejo
↓
Normalizar archivo
↓
Cargar a staging
↓
Validar datos
↓
Resolver conflictos
↓
Confirmar migracion
↓
Generar datos historicos o reservas
```

## Datos minimos de staging

### Cobradores

- Nombre.
- Telefono.
- Email si existe.
- Codigo externo si existe.

### Compradores

- Nombre o razon social.
- Telefono.
- Documento o CUIT si existe.
- Domicilio si existe.
- Codigo externo si existe.

### Historico de numeros

- Campana anterior.
- Numero habitual.
- Comprador.
- Cobrador.
- Tipo de bono si existe.

## Validaciones

- Compradores duplicados.
- Cobradores duplicados.
- Numeros repetidos en la misma campana historica.
- Comprador sin cobrador.
- Cobrador no encontrado.
- Formato de numero invalido.
- Telefonos o documentos inconsistentes.

## Resultado de migracion

La migracion puede crear:

- Cobradores.
- Compradores.
- Historial de numeros.
- Relacion comprador-cobrador habitual.
- Reservas sugeridas para nueva campana.
- Conflictos de renovacion.

## Reservas historicas

La migracion no debe vender automaticamente bonos nuevos.

Debe generar sugerencias o reservas:

```txt
Comprador historico
↓
Numero habitual
↓
Cobrador habitual
↓
Sistema verifica disponibilidad en nueva campana
↓
Reserva o conflicto
```

## Conflictos

Ejemplos:

- Numero historico no existe en nueva campana.
- Numero historico pertenece a una pata.
- Numero historico ya fue asignado a otro comprador.
- Comprador duplicado.
- Cobrador inexistente.

Cada conflicto debe poder resolverse manualmente.

## Reglas de seguridad

- No escribir datos definitivos sin vista previa.
- No sobrescribir compradores existentes sin confirmacion.
- No borrar datos migrados sin anulacion auditada.
- Guardar archivo fuente o referencia a la importacion cuando sea posible.
