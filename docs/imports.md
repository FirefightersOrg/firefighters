# Importaciones y carga por codigo de barras

## Objetivo

Definir como ingresar datos de bonos, compradores, cobradores e historicos sin depender de carga manual uno por uno.

## Carga de bonos por codigo de barras

Cada bono fisico contiene un codigo de barras. El sistema debe poder usarlo para acelerar la carga y busqueda.

## Problema a resolver

Todavia no esta confirmado que dato representa el codigo de barras del sistema viejo.

Posibilidades:

- Numero base visible.
- Identificador interno del bono.
- Codigo heredado externo.
- Otro valor no documentado.

## Configuracion por campana

La campana debe definir como interpretar codigos.

Campo sugerido:

```txt
barcode_mode
```

Valores:

```txt
base_number
internal_code
external_legacy_code
manual_mapping
```

## Flujo de carga por escaneo

```txt
Crear sesion de carga
↓
Seleccionar campana
↓
Seleccionar tipo de carga: bono simple o pata
↓
Escanear codigo de barras
↓
Sistema interpreta el valor segun barcode_mode
↓
Sistema calcula numero asociado si corresponde
↓
Sistema valida rango y duplicados
↓
Sistema agrega item a vista previa
↓
Usuario confirma lote
↓
Sistema crea bonos y numeros participantes
```

## Carga de patas por escaneo

Para patas, el sistema debe permitir agrupar varios escaneos en una misma unidad comercial.

```txt
Crear pata
↓
Escanear N numeros base
↓
Sistema calcula N asociados
↓
Sistema valida N unidades comerciales
↓
Sistema calcula valor de pata
↓
Confirmar pata
```

## Sesiones de importacion

Toda carga masiva debe tener una sesion.

Campos sugeridos:

- `id`
- `campaign_id`
- `source_type`
- `status`
- `created_by`
- `created_at`
- `confirmed_at`
- `notes`

Tipos de origen:

- `barcode_scan`
- `csv_file`
- `excel_file`
- `legacy_system_export`

Estados:

- `draft`
- `validated`
- `confirmed`
- `cancelled`
- `failed`

## Validaciones

Antes de confirmar una carga, el sistema debe validar:

- Formato del numero.
- Rango segun campana.
- Numero asociado dentro del maximo.
- Numero participante duplicado.
- Codigo de barras duplicado.
- Pata incompleta.
- Bono ya existente.
- Conflicto con reserva historica si aplica.

## Importacion desde archivo

Formato CSV inicial sugerido para bonos:

```csv
tipo_bono,grupo_pata,numero_base,barcode
simple,,1658,1658
simple,,0068,0068
pata,PATA1200,1200,PATA1200-1200
pata,PATA1200,1315,PATA1200-1315
```

Formato CSV inicial sugerido para historicos:

```csv
collector_name,buyer_name,buyer_phone,number_value,campaign_name
Juan Perez,Diego Fernandez,1122334455,0068,2024-2025
```

## Vista previa

Antes de confirmar, mostrar:

- Total de bonos simples.
- Total de patas.
- Total de numeros base.
- Total de numeros participantes.
- Errores bloqueantes.
- Advertencias.
- Duplicados.

## Confirmacion

La importacion confirmada debe crear datos definitivos en una transaccion cuando sea posible.

Si falla parcialmente, debe quedar registro del error y no dejar datos inconsistentes.

## Rollback funcional

Si una importacion fue confirmada por error, no se debe borrar silenciosamente.

Regla:

```txt
Anular importacion mediante proceso auditado.
```

La anulacion debe marcar como anulados los bonos creados si no tienen ventas, pagos o rendiciones. Si ya tienen operaciones, requiere correccion administrativa especifica.
