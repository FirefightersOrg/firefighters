# Project Technology Stack

> Reference document for human developers and AI agents.
>
> Decision status: **MVP WebApp/PWA with SvelteKit + TypeScript + Supabase**.
>
> Explicit decision: **Tauri, Rust, and a complex custom backend are outside the MVP**.

---

## 1. Executive Summary

The project will first be developed as an **installable PWA-style webapp**, accessible from a browser on PC, phone, and tablet. The MVP priority is to validate the system's functional flow, accelerate development, and avoid premature complexity.

### Stack Chosen for the MVP

```txt
SvelteKit + TypeScript + PWA + Supabase
```

### Stack Excluded from the MVP

```txt
Tauri
Rust
Complex custom backend from day 1
```

### Target Stack After the MVP

```txt
SvelteKit + custom API + RDS PostgreSQL + S3 + Cognito/IAM + AWS
```

The strategy is to build the MVP on a foundation that does not block a future migration to native AWS. Supabase will be used to accelerate initial development, but critical business logic must remain as decoupled as possible.

---

## 2. Project Context

The system will be oriented toward the operational management of the fire station. Based on the modules discussed so far, the system may include:

- Member management.
- Raffle management.
- Customer management.
- Collector management.
- Payment recording.
- Receipt issuance.
- Economic reports.
- User and permission control.
- Movement auditing.
- Exports and reports.

The system must be usable from different devices and by different user profiles. Therefore, the source of truth must be centralized and not located in a local desktop installation.

---

## 3. Main Architecture Decision

### Chosen for the MVP

```txt
Web client / PWA
        |
        v
SvelteKit + TypeScript
        |
        v
Supabase Auth + Supabase Postgres + Supabase Storage
```

### Reason

A PWA can cover PC, phone, and tablet without building a separate desktop application. The user can open the app from the browser or install it as a shortcut/application from the compatible operating system.

Supabase accelerates the MVP because it provides Postgres, authentication, APIs, storage, local environment, and migration tools without building all custom infrastructure from scratch.

### Important Decision

The MVP must not become an irreversible dependency on Supabase. Code decisions must facilitate a future migration toward native AWS.

---

## 4. MVP Technology Stack

| Area | Technology | Decision |
|---|---|---|
| Web framework | SvelteKit | Main application framework |
| Language | TypeScript | Required for frontend and minimal server-side logic |
| App type | PWA | Installable, responsive web app usable on PC/phone/tablet |
| Runtime | Node.js LTS | For SvelteKit server-side when applicable |
| Package manager | pnpm | Only allowed package manager |
| Initial backend | SvelteKit server actions / API routes | Only for sensitive logic or minimal endpoints |
| Database | Supabase Postgres | Main relational database for the MVP |
| Authentication | Supabase Auth | Login, sessions, and MVP users |
| Authorization | RLS + server-side logic | Row Level Security in Supabase and additional server-side controls |
| Storage | Supabase Storage | Files, proof documents, receipts, or MVP attachments |
| Validations | Zod | Form, DTO, and input data validation |
| Styles/UI | Tailwind CSS or custom CSS | Define before implementing many screens |
| Testing | Vitest / Playwright | Unit tests and end-to-end tests when applicable |
| Local development | Supabase CLI + Docker | Reproducible local stack |
| CI/CD | GitHub Actions | Automatic checks per PR/push |
| Local security | Gitleaks / ESLint / TypeScript checks | Prevention of basic errors and secrets |

---

## 5. Technologies Not Used in the MVP

### Tauri

It will not be used in the MVP.

Reason:

- The current goal is a webapp/PWA, not an installable desktop application.
- It adds builds per operating system.
- It adds installer distribution.
- It adds desktop update maintenance.
- It does not remove the need for a centralized backend/database.

Tauri will only be reconsidered if a concrete need appears:

- Strong offline use.
- Advanced access to local printers.
- Access to local hardware.
- Native integration with Windows/Linux/macOS.
- Mandatory installer for a fire station PC.

### Rust

It will not be used as the main MVP backend.

Reason:

- The MVP needs development speed.
- The app is mainly administrative and transactional.
- TypeScript allows sharing the language between frontend, validations, and minimal server-side logic.
- Rust can be incorporated later if a real technical need appears.

### Complex Custom Backend

A separate API will not be built from day 1 unless the scope changes.

Reason:

- SvelteKit server actions/API routes are enough to encapsulate sensitive MVP operations.
- Supabase already provides Auth, Postgres, APIs, and Storage.
- Creating a complete custom API before validating the product would increase the initial cost.

---

## 6. Planned Supabase Usage in the MVP

Supabase must be used as an MVP accelerator, not as a place to hide critical undocumented logic.

### Allowed Components

```txt
Supabase Auth
Supabase Postgres
Supabase Storage
Supabase CLI
Supabase migrations
Supabase local development
Row Level Security
```

### Components Allowed with Caution

```txt
Supabase Edge Functions
Supabase Realtime
Complex triggers in Postgres
SQL functions with extensive business logic
```

Use them only if they solve a concrete problem. If used, they must be documented.

### Components to Initially Avoid

```txt
Critical business logic distributed across frontend, RLS, triggers, and Edge Functions without documentation
Use of service_role key in the client
Strong dependencies on proprietary APIs if there is a simple alternative
Designs that make migration to RDS PostgreSQL difficult
```

---

## 7. Security Rules for Supabase

### Mandatory Rules

- Never expose `SUPABASE_SERVICE_ROLE_KEY` in the browser.
- The `service_role key` can only exist in a secure server-side environment.
- All tables exposed from the client must have RLS enabled.
- RLS policies must be versioned as SQL migrations.
- Application roles must be modeled explicitly.
- Permissions must not depend only on hiding buttons in the UI.
- Every sensitive change must leave an audit trail.
- Payments, receipts, movements, and settlements must not be physically deleted without an explicit audit decision.

### Initially Expected Roles

The exact names may change, but the model must include at least:

```txt
admin
operator
collector
read_only
```

### Suggested Permission Model

```txt
admin:
  full functional access, except irreversible destructive operations if restricting them is decided

operator:
  operational creation/editing of members, customers, raffles, and payments according to defined rules

treasurer:
  economic reports, settlements, reconciliations, payment control

collector:
  limited access to their portfolio, assigned payments, and allowed records

read_only:
  read-only, with defined scope
```

### Minimum Audit

Every sensitive operation should save:

```txt
user
date/time
action
affected entity
entity id
previous value when applicable
new value when applicable
operation origin
```

---

## 8. Data Design

### Principles

- Use relational PostgreSQL as the source of truth.
- Version all schema changes through migrations.
- Prefer real referential integrity with foreign keys.
- Use constraints for invariant rules.
- Avoid critical logic only in the frontend.
- Avoid physical deletes in economic entities without proven need.

### Expected Entities

The final model may change, but the domain should include:

```txt
users / profiles
roles
permissions
members
customers
collectors
raffles
bonds
numbers
sales
payments
receipts
movements
settlements
reports
audit_log
files / proof documents
```

### Modeling Criteria

- Payments must be traceable.
- Receipts must have numbering or a unique identifier.
- State changes must be recorded.
- Economic reports must be reconstructible from transactional data.
- Historical operations must not depend on current values that may change.

Example: if a collector's name changes, a historical receipt should not lose context.

---

## 9. PWA

The app will be a PWA from the MVP.

### Objectives

- Installable from the browser when the device allows it.
- Responsive for PC, phone, and tablet.
- Fast loading.
- App-like experience.
- Partial offline only for assets and allowed screens.

### Initial Offline Scope

For the MVP, offline must be limited.

Initially allowed:

```txt
static asset cache
friendly offline error screen
possible access to latest non-sensitive views if implementation is decided
```

Not initially recommended:

```txt
offline payment loading
offline synchronization of economic operations
offline conflict resolution
complex transactional local database
```

Reason: economic and administrative operations must maintain strong consistency. Real offline support can become one of the system's most complex problems.

---

## 10. Initial Backend with SvelteKit

The MVP can use SvelteKit as a lightweight full-stack application.

### Use Server-Side For

- Sensitive validations.
- Operations that require `service_role`.
- Receipt or document generation if applicable.
- Queries that must not be exposed directly to the client.
- Report aggregations.
- External integrations.
- Administrative actions.

### Do Not Use Server-Side For

- Unnecessarily duplicating everything Supabase can solve safely with RLS.
- Creating a huge API before validating the MVP.
- Mixing business logic directly into visual components.

### Architecture Rule

Business logic must stay outside UI components.

Suggested locations:

```txt
src/lib/domain/
src/lib/schemas/
src/lib/server/repositories/
src/lib/server/services/
src/lib/server/auth/
```

---

## 11. Suggested Repository Structure

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

## 12. Environment Files

### `.env.example`

It must always exist and must not contain real secrets.

Expected variables for MVP:

```env
PUBLIC_SUPABASE_URL=
PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
APP_ENV=local
```

Rules:

- `PUBLIC_*` may be available in the client.
- `SUPABASE_SERVICE_ROLE_KEY` must never be available in the client.
- The real `.env` must be ignored by Git.
- AI agents must not invent real values.

---

## 13. Local Development

### Required Tools

```txt
Git
Node.js LTS
pnpm
Docker
Supabase CLI
TypeScript/Svelte-compatible editor
```

### Expected Flow

```bash
pnpm install
supabase start
pnpm dev
```

### Local Validation

```bash
pnpm check
pnpm lint
pnpm test
```

### Diagnosis

A diagnosis script must exist:

```bash
./scripts/doctor.sh
```

The script should verify at least:

```txt
node
pnpm
docker
supabase CLI
expected environment variables
local connection to Supabase
```

---

## 14. CI/CD

### Minimum Pull Request Validations

```txt
pnpm install --frozen-lockfile
pnpm check
pnpm lint
pnpm test
Supabase migration validation
basic secret scanning
```

### Rules

- Do not merge changes that break TypeScript.
- Do not merge unreviewed migrations.
- Do not merge changes with secrets.
- Do not merge changes that alter permissions/RLS without explanation.
- Every architecture modification must be documented.

---

## 15. Instructions for AI Agents

AI agents must follow these rules:

### Before Modifying Code

- Read `README.md`.
- Read this document.
- Read `AGENTS.md` if it exists.
- Inspect real files before proposing changes.
- Do not assume modules, folders, or scripts exist if they are not in the repository.

### During Development

- Prefer small, reviewable changes.
- Do not introduce dependencies without justification.
- Do not change the technology stack without asking for confirmation.
- Do not add Tauri.
- Do not add Rust.
- Do not create a separate backend unless explicitly requested.
- Do not remove Supabase from the MVP.
- Do not expose private keys in the client.
- Do not weaken RLS to "make it work quickly".

### After Modifying Code

Run or clearly state if unable to run:

```bash
pnpm check
pnpm lint
pnpm test
```

If migrations or security policies are modified, explain:

```txt
what changed
why it changed
what risk it reduces
what new risk it introduces
how it is tested
```

---

## 16. Code Conventions

### TypeScript

- Strict TypeScript whenever possible.
- Avoid `any` except with specific justification.
- Validate inputs with Zod or another defined tool.
- Type Supabase responses.
- Centralize domain types.

### SvelteKit

- Simple visual components.
- Reusable logic in `src/lib`.
- Server-side logic in `src/lib/server`.
- Do not access private variables from the client.
- Separate forms, validations, and services.

### Database

- Versioned migrations.
- Constraints for critical rules.
- Foreign keys when applicable.
- Indexes for frequent searches.
- Audit for sensitive entities.

---

## 17. Post-MVP Strategy: Migration to Native AWS

When the MVP is validated, the target architecture will be:

```txt
PWA SvelteKit
        |
        v
custom API
        |
        v
RDS PostgreSQL
        |
        +--> S3
        +--> Cognito/IAM
        +--> CloudWatch
        +--> Secrets Manager
```

### Expected Post-MVP Stack

| Area | Target technology |
|---|---|
| Web/PWA | SvelteKit + TypeScript |
| API | Custom API in Node.js/TypeScript initially, unless a contrary decision is made |
| Database | Amazon RDS PostgreSQL |
| Files | Amazon S3 |
| Authentication | Amazon Cognito or defined OIDC/SAML integration |
| Authorization | Custom API + roles/permissions + IAM where applicable |
| Secrets | AWS Secrets Manager |
| Logs/monitoring | CloudWatch |
| Infrastructure | Terraform |
| CI/CD | GitHub Actions |
| Security | IAM least privilege, WAF if applicable, backups, audit |

### Rules to Facilitate Migration

These rules must be respected from the MVP:

- Keep business logic outside UI components.
- Encapsulate Supabase access in specific modules.
- Do not scatter queries throughout the application.
- Keep SQL migrations clear.
- Avoid Edge Functions unless there is a real need.
- Avoid complex triggers as a replacement for domain services.
- Do not depend on proprietary features if standard PostgreSQL is enough.
- Separate the domain model from concrete SDKs.
- Document all RLS policies.
- Maintain a repository/service layer that can later point to a custom API.

---

## 18. Known Risks

### Risk: Supabase as a Strong Dependency

Mitigation:

- Keep the domain decoupled.
- Do not overuse Edge Functions.
- Version SQL.
- Document RLS.
- Design with standard PostgreSQL in mind.

### Risk: Poorly Designed RLS

Mitigation:

- Enable RLS from the start.
- Review policies in PR.
- Create permission tests.
- Use explicit roles.
- Do not trust only the UI.

### Risk: Overly Ambitious Offline Support

Mitigation:

- Partial offline in MVP.
- Do not record offline payments initially.
- Do not synchronize economic operations until there is a formal design.

### Risk: Inconsistent Reports

Mitigation:

- Use transactional data.
- Do not overwrite history.
- Audit movements.
- Design states and monthly closings carefully.

### Risk: Underestimated Future Migration

Mitigation:

- Define Supabase usage boundaries now.
- Document which part AWS would replace.
- Avoid unnecessary coupling.

---

## 19. Registered Explicit Decisions

### Decision 1: MVP WebApp/PWA

A webapp/PWA will be built to cover PC, phone, and tablet without a separate desktop application.

### Decision 2: Supabase to Accelerate MVP

Supabase will be used for Auth, Postgres, Storage, and local environment during the MVP.

### Decision 3: No Tauri in MVP

Tauri is excluded until there is a real desktop need.

### Decision 4: No Rust in MVP

Rust is excluded from the MVP to prioritize development speed and simplicity.

### Decision 5: No Complex Custom Backend from Day 1

SvelteKit server-side and Supabase will cover the initial needs. A custom API will be evaluated after the MVP.

### Decision 6: AWS as Post-MVP Destination

The architecture after the MVP points to AWS with a custom API, RDS PostgreSQL, S3, Cognito/IAM, Secrets Manager, CloudWatch, and Terraform.

---

## 20. Relationship with the Current Project README

The previously generated README was oriented toward:

```txt
Svelte + Rust + Tauri v2 + AWS + LocalStack
```

That orientation is replaced for the MVP by:

```txt
SvelteKit + TypeScript + PWA + Supabase
```

Repository files must be updated to reflect this decision:

```txt
README.md
AGENTS.md
CLAUDE.md
opencode.json if it exists
Taskfile.yml
mise.toml
scripts/bootstrap-*
scripts/doctor.sh
docker-compose.local.yml
.github/workflows/ci.yml
```

In particular, any instruction that assumes `src-tauri`, `cargo`, `rustfmt`, `clippy`, or `pnpm tauri:dev` must be removed or moved to historical documentation.

---

## 21. MVP Target Commands

The exact commands can be adjusted when initializing the project, but the recommended contract is:

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

Local Supabase:

```bash
supabase init
supabase start
supabase status
supabase stop
```

Migrations:

```bash
supabase migration new <name>
supabase db reset
```

---

## 22. Definition of Done

A task is considered complete when:

- The code compiles.
- TypeScript reports no errors.
- Relevant tests pass.
- There are no new secrets.
- Migrations are versioned.
- Affected RLS policies are documented.
- The UI works on desktop and mobile when applicable.
- Documentation was updated if architecture, commands, or variables changed.
- The change does not introduce Tauri, Rust, or a complex custom backend without explicit approval.

---

## 23. Open Questions

Before fully closing the MVP architecture, the following still need to be defined:

- Initial SvelteKit hosting: AWS, Vercel, Netlify, or another provider.
- Whether SvelteKit will run with SSR or as a mainly static app.
- Supabase plan for production.
- Supabase region.
- Final role model.
- Exact audit rules.
- Whether receipts will be printable HTML, PDF, both, or persistent storage.
- Whether there will be email/WhatsApp integration.
- Backup and recovery strategy.
- Exact time to migrate to native AWS.

---

## 24. Guiding Criterion

The MVP priority is to build a useful, secure, and maintainable application without overengineering.

Practical rule:

```txt
First validate the product.
Then harden the architecture.
Finally migrate or scale infrastructure if real usage justifies it.
```
