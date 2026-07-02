# Stack tecnológico del proyecto

> Documento de referencia para desarrolladores humanos y agentes de IA.
>
> Estado de decisión: **MVP WebApp/PWA con SvelteKit + TypeScript + Supabase**.
>
> Decisión explícita: **Tauri, Rust y un backend propio complejo quedan fuera del MVP**.

---

## 1. Resumen ejecutivo

El proyecto se desarrollará primero como una **webapp instalable tipo PWA**, accesible desde navegador en PC, celular y tablet. La prioridad del MVP es validar el flujo funcional del sistema, acelerar el desarrollo y evitar complejidad prematura.

### Stack elegido para el MVP

```txt
SvelteKit + TypeScript + PWA + Supabase
```

### Stack descartado para el MVP

```txt
Tauri
Rust
Backend propio complejo desde el día 1
```

### Stack objetivo posterior al MVP

```txt
SvelteKit + API propia + RDS PostgreSQL + S3 + Cognito/IAM + AWS
```

La estrategia es construir el MVP sobre una base que no bloquee una migración futura a AWS nativo. Supabase se usará para acelerar el desarrollo inicial, pero la lógica crítica del negocio debe mantenerse lo más desacoplada posible.

---

## 2. Contexto del proyecto

El sistema estará orientado a la gestión operativa del cuartel de bomberos. Según los módulos conversados hasta el momento, el sistema puede incluir:

- Gestión de socios.
- Gestión de rifas.
- Gestión de clientes.
- Gestión de cobradores.
- Registro de pagos.
- Emisión de recibos.
- Reportes económicos.
- Control de usuarios y permisos.
- Auditoría de movimientos.
- Exportaciones e informes.

El sistema debe ser usable desde diferentes dispositivos y por diferentes perfiles de usuario. Por eso, la fuente de verdad debe estar centralizada y no en una instalación local de escritorio.

---

## 3. Decisión principal de arquitectura

### Elegido para el MVP

```txt
Cliente web / PWA
        |
        v
SvelteKit + TypeScript
        |
        v
Supabase Auth + Supabase Postgres + Supabase Storage
```

### Motivo

Una PWA permite cubrir PC, celular y tablet sin construir una aplicación de escritorio separada. El usuario puede abrir la app desde el navegador o instalarla como acceso directo/aplicación desde el sistema operativo compatible.

Supabase permite acelerar el MVP porque ofrece Postgres, autenticación, APIs, storage, entorno local y herramientas de migración sin construir toda la infraestructura propia desde cero.

### Decisión importante

El MVP no debe convertirse en una dependencia irreversible de Supabase. Las decisiones de código deben facilitar una migración futura hacia AWS nativo.

---

## 4. Stack tecnológico del MVP

| Área | Tecnología | Decisión |
|---|---|---|
| Framework web | SvelteKit | Framework principal de la aplicación |
| Lenguaje | TypeScript | Obligatorio para frontend y lógica server-side mínima |
| Tipo de app | PWA | Web instalable, responsive y usable en PC/celular/tablet |
| Runtime | Node.js LTS | Para SvelteKit server-side cuando corresponda |
| Package manager | pnpm | Único package manager permitido |
| Backend inicial | SvelteKit server actions / API routes | Solo para lógica sensible o endpoints mínimos |
| Base de datos | Supabase Postgres | Base relacional principal del MVP |
| Autenticación | Supabase Auth | Login, sesiones y usuarios del MVP |
| Autorización | RLS + lógica server-side | Row Level Security en Supabase y controles adicionales del lado servidor |
| Storage | Supabase Storage | Archivos, comprobantes, recibos o adjuntos del MVP |
| Validaciones | Zod | Validación de formularios, DTOs y datos de entrada |
| Estilos/UI | Tailwind CSS o CSS propio | Definir antes de implementar pantallas masivas |
| Testing | Vitest / Playwright | Unit tests y tests end-to-end cuando aplique |
| Desarrollo local | Supabase CLI + Docker | Stack local reproducible |
| CI/CD | GitHub Actions | Checks automáticos por PR/push |
| Seguridad local | Gitleaks / ESLint / TypeScript checks | Prevención de errores básicos y secretos |

---

## 5. Tecnologías no utilizadas en el MVP

### Tauri

No se usará en el MVP.

Motivo:

- El objetivo actual es una webapp/PWA, no una aplicación desktop instalable.
- Agrega builds por sistema operativo.
- Agrega distribución de instaladores.
- Agrega mantenimiento de actualizaciones desktop.
- No elimina la necesidad de backend/base centralizada.

Tauri solo se reconsiderará si aparece una necesidad concreta:

- Uso offline fuerte.
- Acceso avanzado a impresoras locales.
- Acceso a hardware local.
- Integración nativa con Windows/Linux/macOS.
- Instalador obligatorio para una PC del cuartel.

### Rust

No se usará como backend principal del MVP.

Motivo:

- El MVP necesita velocidad de desarrollo.
- La app es principalmente administrativa y transaccional.
- TypeScript permite compartir lenguaje entre frontend, validaciones y server-side mínimo.
- Rust puede ser incorporado más adelante si aparece una necesidad técnica real.

### Backend propio complejo

No se construirá una API separada desde el día 1 salvo que el alcance cambie.

Motivo:

- SvelteKit server actions/API routes son suficientes para encapsular operaciones sensibles del MVP.
- Supabase ya aporta Auth, Postgres, APIs y Storage.
- Crear una API propia completa antes de validar el producto aumentaría el costo inicial.

---

## 6. Uso previsto de Supabase en el MVP

Supabase debe usarse como acelerador del MVP, no como lugar para esconder lógica crítica sin documentación.

### Componentes permitidos

```txt
Supabase Auth
Supabase Postgres
Supabase Storage
Supabase CLI
Supabase migrations
Supabase local development
Row Level Security
```

### Componentes permitidos con cautela

```txt
Supabase Edge Functions
Supabase Realtime
Triggers complejos en Postgres
Funciones SQL con mucha lógica de negocio
```

Usarlos solo si resuelven un problema concreto. Si se usan, deben estar documentados.

### Componentes a evitar inicialmente

```txt
Lógica de negocio crítica distribuida entre frontend, RLS, triggers y Edge Functions sin documentación
Uso de service_role key en el cliente
Dependencias fuertes a APIs propietarias si hay alternativa simple
Diseños que dificulten migrar a RDS PostgreSQL
```

---

## 7. Reglas de seguridad para Supabase

### Reglas obligatorias

- No exponer nunca `SUPABASE_SERVICE_ROLE_KEY` en el navegador.
- La `service_role key` solo puede existir en entorno server-side seguro.
- Todas las tablas expuestas desde cliente deben tener RLS habilitado.
- Las políticas RLS deben estar versionadas como migraciones SQL.
- Los roles de aplicación deben estar modelados explícitamente.
- Los permisos no deben depender únicamente de ocultar botones en la UI.
- Todo cambio sensible debe dejar rastro de auditoría.
- Los pagos, recibos, movimientos y liquidaciones no deben eliminarse físicamente sin una decisión explícita de auditoría.

### Roles esperados inicialmente

Los nombres exactos pueden cambiar, pero el modelo debe contemplar al menos:

```txt
admin
operador
tesorero
cobrador
consulta
```

### Modelo sugerido de permisos

```txt
admin:
  acceso total funcional, excepto operaciones destructivas irreversibles si se decide restringirlas

operador:
  alta/edición operativa de socios, clientes, rifas y pagos según reglas definidas

tesorero:
  reportes económicos, liquidaciones, conciliaciones, control de pagos

cobrador:
  acceso limitado a su cartera, pagos asignados y registros permitidos

consulta:
  solo lectura, con alcance definido
```

### Auditoría mínima

Toda operación sensible debería guardar:

```txt
usuario
fecha/hora
acción
entidad afectada
id de entidad
valor anterior cuando aplique
valor nuevo cuando aplique
origen de la operación
```

---

## 8. Diseño de datos

### Principios

- Usar PostgreSQL relacional como fuente de verdad.
- Versionar todos los cambios de esquema mediante migraciones.
- Preferir integridad referencial real con foreign keys.
- Usar constraints para reglas invariantes.
- Evitar lógica crítica solamente en frontend.
- Evitar borrados físicos en entidades económicas sin necesidad comprobada.

### Entidades esperadas

El modelo final puede cambiar, pero el dominio debería contemplar:

```txt
users / profiles
roles
permissions
socios
clientes
cobradores
rifas
bonos
numeros
ventas
pagos
recibos
movimientos
liquidaciones
reportes
audit_log
archivos / comprobantes
```

### Criterios de modelado

- Los pagos deben ser trazables.
- Los recibos deben tener numeración o identificador único.
- Los cambios de estado deben quedar registrados.
- Los reportes económicos deben poder reconstruirse desde datos transaccionales.
- Las operaciones históricas no deben depender de valores actuales que puedan cambiar.

Ejemplo: si cambia el nombre de un cobrador, un recibo histórico no debería perder contexto.

---

## 9. PWA

La app será una PWA desde el MVP.

### Objetivos

- Instalable desde navegador cuando el dispositivo lo permita.
- Responsive para PC, celular y tablet.
- Carga rápida.
- Experiencia similar a aplicación.
- Offline parcial solo para assets y pantallas permitidas.

### Alcance offline inicial

Para el MVP, el offline debe ser limitado.

Permitido inicialmente:

```txt
cache de assets estáticos
pantalla de error amigable sin conexión
posible acceso a últimas vistas no sensibles si se decide implementar
```

No recomendado inicialmente:

```txt
carga de pagos offline
sincronización offline de operaciones económicas
resolución de conflictos offline
base local transaccional compleja
```

Motivo: las operaciones económicas y administrativas deben mantener consistencia fuerte. El offline real puede convertirse en uno de los problemas más complejos del sistema.

---

## 10. Backend inicial con SvelteKit

El MVP puede usar SvelteKit como aplicación full-stack liviana.

### Usar server-side para

- Validaciones sensibles.
- Operaciones que requieren `service_role`.
- Generación de recibos o documentos si corresponde.
- Consultas que no deben exponerse directamente al cliente.
- Agregaciones de reportes.
- Integraciones externas.
- Acciones administrativas.

### No usar server-side para

- Duplicar innecesariamente todo lo que Supabase puede resolver de forma segura con RLS.
- Crear una API enorme antes de validar el MVP.
- Mezclar lógica de negocio directamente en componentes visuales.

### Regla de arquitectura

La lógica de negocio debe quedar fuera de los componentes de UI.

Ubicaciones sugeridas:

```txt
src/lib/domain/
src/lib/schemas/
src/lib/server/repositories/
src/lib/server/services/
src/lib/server/auth/
```

---

## 11. Estructura sugerida del repositorio

```txt
repo/
├── AGENTS.md
├── CLAUDE.md
├── README.md
├── STACK_TECNOLOGICO.md
├── package.json
├── pnpm-lock.yaml
├── svelte.config.js
├── vite.config.ts
├── tsconfig.json
├── .env.example
├── .gitignore
├── .editorconfig
├── docker-compose.local.yml
├── Taskfile.yml
├── scripts/
│   ├── bootstrap-linux.sh
│   ├── bootstrap-macos.sh
│   ├── bootstrap-windows.ps1
│   └── doctor.sh
├── src/
│   ├── app.html
│   ├── routes/
│   └── lib/
│       ├── components/
│       ├── domain/
│       ├── schemas/
│       ├── stores/
│       ├── supabase/
│       └── server/
│           ├── auth/
│           ├── repositories/
│           └── services/
├── static/
│   ├── manifest.webmanifest
│   ├── icons/
│   └── service-worker-assets/
├── supabase/
│   ├── config.toml
│   ├── migrations/
│   ├── seed.sql
│   └── functions/
├── tests/
├── docs/
│   ├── architecture.md
│   ├── security.md
│   ├── data-model.md
│   ├── local-development.md
│   └── decisions/
└── .github/
    └── workflows/
        └── ci.yml
```

---

## 12. Archivos de entorno

### `.env.example`

Debe existir siempre y no debe contener secretos reales.

Variables esperadas para MVP:

```env
PUBLIC_SUPABASE_URL=
PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
APP_ENV=local
```

Reglas:

- `PUBLIC_*` puede estar disponible en cliente.
- `SUPABASE_SERVICE_ROLE_KEY` nunca puede estar disponible en cliente.
- `.env` real debe estar ignorado por Git.
- Los agentes IA no deben inventar valores reales.

---

## 13. Desarrollo local

### Herramientas necesarias

```txt
Git
Node.js LTS
pnpm
Docker
Supabase CLI
Editor compatible con TypeScript/Svelte
```

### Flujo esperado

```bash
pnpm install
supabase start
pnpm dev
```

### Validación local

```bash
pnpm check
pnpm lint
pnpm test
```

### Diagnóstico

Debe existir un script de diagnóstico:

```bash
./scripts/doctor.sh
```

El script debería verificar, como mínimo:

```txt
node
pnpm
docker
supabase CLI
variables de entorno esperadas
conexión local a Supabase
```

---

## 14. CI/CD

### Validaciones mínimas en Pull Request

```txt
pnpm install --frozen-lockfile
pnpm check
pnpm lint
pnpm test
validación de migraciones Supabase
escaneo básico de secretos
```

### Reglas

- No mergear cambios que rompan TypeScript.
- No mergear migraciones no revisadas.
- No mergear cambios con secretos.
- No mergear cambios que alteren permisos/RLS sin explicación.
- Toda modificación de arquitectura debe documentarse.

---

## 15. Instrucciones para agentes IA

Los agentes IA deben seguir estas reglas:

### Antes de modificar código

- Leer `README.md`.
- Leer este documento.
- Leer `AGENTS.md` si existe.
- Inspeccionar archivos reales antes de proponer cambios.
- No asumir que existen módulos, carpetas o scripts que no están en el repositorio.

### Durante el desarrollo

- Preferir cambios pequeños y revisables.
- No introducir dependencias sin justificar.
- No cambiar el stack tecnológico sin pedir confirmación.
- No agregar Tauri.
- No agregar Rust.
- No crear backend separado salvo pedido explícito.
- No eliminar Supabase del MVP.
- No exponer claves privadas en cliente.
- No debilitar RLS para “hacer funcionar rápido”.

### Después de modificar código

Ejecutar o indicar claramente si no pudo ejecutar:

```bash
pnpm check
pnpm lint
pnpm test
```

Si se modifican migraciones o políticas de seguridad, explicar:

```txt
qué cambió
por qué cambió
qué riesgo reduce
qué riesgo nuevo introduce
cómo se prueba
```

---

## 16. Convenciones de código

### TypeScript

- TypeScript estricto siempre que sea posible.
- Evitar `any` salvo justificación puntual.
- Validar inputs con Zod u otra herramienta definida.
- Tipar respuestas de Supabase.
- Centralizar tipos de dominio.

### SvelteKit

- Componentes visuales simples.
- Lógica reutilizable en `src/lib`.
- Lógica server-side en `src/lib/server`.
- No acceder a variables privadas desde cliente.
- Separar formularios, validaciones y servicios.

### Base de datos

- Migraciones versionadas.
- Constraints para reglas críticas.
- Foreign keys cuando corresponda.
- Índices para búsquedas frecuentes.
- Auditoría para entidades sensibles.

---

## 17. Estrategia post-MVP: migración a AWS nativo

Cuando el MVP esté validado, la arquitectura objetivo será:

```txt
PWA SvelteKit
        |
        v
API propia
        |
        v
RDS PostgreSQL
        |
        +--> S3
        +--> Cognito/IAM
        +--> CloudWatch
        +--> Secrets Manager
```

### Stack post-MVP esperado

| Área | Tecnología objetivo |
|---|---|
| Web/PWA | SvelteKit + TypeScript |
| API | API propia en Node.js/TypeScript inicialmente, salvo decisión contraria |
| Base de datos | Amazon RDS PostgreSQL |
| Archivos | Amazon S3 |
| Autenticación | Amazon Cognito o integración OIDC/SAML definida |
| Autorización | API propia + roles/permisos + IAM donde corresponda |
| Secretos | AWS Secrets Manager |
| Logs/monitoreo | CloudWatch |
| Infraestructura | Terraform |
| CI/CD | GitHub Actions |
| Seguridad | IAM least privilege, WAF si aplica, backups, auditoría |

### Reglas para facilitar la migración

Desde el MVP deben respetarse estas reglas:

- Mantener la lógica de negocio fuera de componentes UI.
- Encapsular acceso a Supabase en módulos específicos.
- No dispersar queries por toda la aplicación.
- Mantener migraciones SQL claras.
- Evitar Edge Functions salvo necesidad real.
- Evitar triggers complejos como reemplazo de servicios de dominio.
- No depender de features propietarias si PostgreSQL estándar alcanza.
- Separar modelo de dominio de SDKs concretos.
- Documentar todas las políticas RLS.
- Mantener una capa de repositorios/servicios que pueda apuntar luego a API propia.

---

## 18. Riesgos conocidos

### Riesgo: Supabase como dependencia fuerte

Mitigación:

- Mantener dominio desacoplado.
- No abusar de Edge Functions.
- Versionar SQL.
- Documentar RLS.
- Diseñar pensando en PostgreSQL estándar.

### Riesgo: RLS mal diseñado

Mitigación:

- Activar RLS desde el inicio.
- Revisar políticas en PR.
- Crear tests de permisos.
- Usar roles explícitos.
- No confiar solo en UI.

### Riesgo: offline demasiado ambicioso

Mitigación:

- Offline parcial en MVP.
- No registrar pagos offline inicialmente.
- No sincronizar operaciones económicas hasta tener diseño formal.

### Riesgo: reportes inconsistentes

Mitigación:

- Usar datos transaccionales.
- No sobrescribir historial.
- Auditar movimientos.
- Diseñar estados y cierres mensuales con cuidado.

### Riesgo: migración futura subestimada

Mitigación:

- Definir desde ahora límites de uso de Supabase.
- Documentar qué parte reemplazaría AWS.
- Evitar acoplamientos innecesarios.

---

## 19. Decisiones explícitas registradas

### Decisión 1: MVP WebApp/PWA

Se construirá una webapp/PWA para cubrir PC, celular y tablet sin una aplicación desktop separada.

### Decisión 2: Supabase para acelerar MVP

Supabase será usado para Auth, Postgres, Storage y entorno local durante el MVP.

### Decisión 3: No Tauri en MVP

Tauri queda fuera hasta que exista una necesidad real de escritorio.

### Decisión 4: No Rust en MVP

Rust queda fuera del MVP para priorizar velocidad de desarrollo y simplicidad.

### Decisión 5: No backend propio complejo desde el día 1

SvelteKit server-side y Supabase cubrirán las necesidades iniciales. Una API propia se evaluará luego del MVP.

### Decisión 6: AWS como destino post-MVP

La arquitectura posterior al MVP apunta a AWS con API propia, RDS PostgreSQL, S3, Cognito/IAM, Secrets Manager, CloudWatch y Terraform.

---

## 20. Relación con README actual del proyecto

El README generado previamente estaba orientado a:

```txt
Svelte + Rust + Tauri v2 + AWS + LocalStack
```

Esa orientación queda reemplazada para el MVP por:

```txt
SvelteKit + TypeScript + PWA + Supabase
```

Se deben actualizar los archivos del repositorio para reflejar esta decisión:

```txt
README.md
AGENTS.md
CLAUDE.md
opencode.json si existe
Taskfile.yml
mise.toml
scripts/bootstrap-*
scripts/doctor.sh
docker-compose.local.yml
.github/workflows/ci.yml
```

En particular, cualquier instrucción que asuma `src-tauri`, `cargo`, `rustfmt`, `clippy` o `pnpm tauri:dev` debe ser eliminada o movida a documentación histórica.

---

## 21. Comandos objetivo del MVP

Los comandos exactos pueden ajustarse al inicializar el proyecto, pero el contrato recomendado es:

```bash
pnpm install
pnpm dev
pnpm build
pnpm preview
pnpm check
pnpm lint
pnpm format
pnpm test
```

Supabase local:

```bash
supabase init
supabase start
supabase status
supabase stop
```

Migraciones:

```bash
supabase migration new <nombre>
supabase db reset
```

---

## 22. Definition of Done

Una tarea se considera terminada cuando:

- El código compila.
- TypeScript no reporta errores.
- Los tests relevantes pasan.
- No hay secretos nuevos.
- Las migraciones están versionadas.
- Las políticas RLS afectadas están documentadas.
- La UI funciona en desktop y mobile cuando aplica.
- La documentación fue actualizada si cambió arquitectura, comandos o variables.
- El cambio no introduce Tauri, Rust ni backend propio complejo sin aprobación explícita.

---

## 23. Preguntas pendientes

Antes de cerrar completamente la arquitectura del MVP, falta definir:

- Hosting inicial de SvelteKit: AWS, Vercel, Netlify u otro.
- Si SvelteKit correrá con SSR o como app principalmente estática.
- Plan de Supabase para producción.
- Región de Supabase.
- Modelo definitivo de roles.
- Reglas exactas de auditoría.
- Si los recibos serán HTML imprimible, PDF, ambos o storage persistente.
- Si habrá integración con email/WhatsApp.
- Estrategia de backups y recuperación.
- Momento exacto para migrar a AWS nativo.

---

## 24. Criterio rector

La prioridad del MVP es construir una aplicación útil, segura y mantenible, sin sobreingeniería.

Regla práctica:

```txt
Primero validar el producto.
Después endurecer arquitectura.
Finalmente migrar o escalar infraestructura si el uso real lo justifica.
```
