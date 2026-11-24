# Historial de auditoría de campaña

El visor muestra todo el historial auditado de la campaña, no solamente las
correcciones. Tanto la lista como el detalle filtran por `audit_log.campaign_id`.
El acceso conserva el requisito `audit.view` y las políticas RLS existentes.
La paginación es explícita, con orden descendente por fecha e identificador.

## Resolución de campaña (SAN-112)

La campaña se fija al insertar el evento en la misma transacción que el cambio.
El trigger reemplaza cualquier alcance suministrado por el llamador. No cambia
los snapshots ni sus claves.

- `campaign`: el identificador de la entidad es la campaña.
- Los snapshots con `campaign_id` en el valor nuevo o anterior tienen prioridad.
  Las correcciones de pagos, ventas y rendiciones también conservan el alcance
  anidado en `previous_value.payment|sale|settlement`.
- Si el snapshot es un diff sin campaña, se consulta la identidad de `bond`,
  `bond_number`, `commission_rule`, `import_session`, `delivery_note`, `sale`,
  `payment`, `settlement`, `collector_ledger_entry`, `commission_adjustment` o
  `draw`. `draw_roster` y `prize` se resuelven mediante su sorteo.
  Estas identidades y sus vínculos de campaña no se eliminan ni se trasladan.
- Los números de bono hoy se auditan mediante operaciones sobre bonos o padrones;
  también queda definida su resolución individual (`bond_number`).
- Los cambios de usuarios, perfiles, roles, permisos y sus asignaciones, cobradores
  y compradores globales no pertenecen a una campaña: su alcance es nulo, aunque
  coincida su identificador con el de una campaña. No se infiere pertenencia por
  un usuario, comprador o cobrador compartido.
- Una entidad desconocida sin campaña explícita queda global. Agregar un nuevo
  tipo auditado requiere revisar su snapshot y su resolución de alcance.

Se usa texto, como en el alcance previo, para que un snapshot histórico con un
identificador no UUID no impida registrar auditoría. La columna generada anterior
`campaign_scope` se conserva por compatibilidad, pero no es el filtro del visor.
El índice compuesto `(campaign_id, created_at DESC, id DESC)` cubre ese filtro y
su orden. No se agregan permisos RPC para las funciones internas de resolución.

La migración recalcula una sola vez el alcance de los eventos existentes, bajo
el bloqueo exclusivo de la tabla, deshabilitando únicamente el guard de
actualización durante ese backfill y restaurándolo antes de terminar. Luego
continúan prohibidas las actualizaciones y eliminaciones del historial.
