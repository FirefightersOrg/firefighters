# Project Technology Stack

> Reference document for human developers and AI agents.
>
> Decision status: **MVP WebApp/PWA with SvelteKit + TypeScript + Supabase**.
>
> Explicit decision: **Tauri, Rust, and a complex custom backend are out of scope for the MVP**.

---

## 1. Executive Summary

The project will initially be developed as an **installable PWA-style webapp**, accessible from a browser on PC, mobile, and tablet. The MVP priority is to validate the system's functional flow, accelerate development, and avoid premature complexity.

### Stack Chosen for the MVP

```txt
SvelteKit + TypeScript + PWA + Supabase
```

### Stack Ruled Out for the MVP

```txt
Tauri
Rust
Complex custom backend from day 1
```

### Target Stack Post-MVP

```txt
SvelteKit + Custom API + RDS PostgreSQL + S3 + Cognito/IAM + AWS
```

The strategy is to build the MVP on a foundation that does not block a future migration to native AWS. Supabase will be used to accelerate initial development, but critical business logic should be kept as decoupled as possible.

---

## 2. Project Context

The system will be oriented toward the operational management of the firefighters station. Based on the modules discussed so far, the system may include:

- Member management.
- Raffle management.
- Buyer management.
- Collector management.
- Payment records.
- Receipt issuance.
- Financial reports.
- User and permission control.
- Transaction auditing.
- Exports and reports.

The system must be usable from different devices and by different user profiles. Therefore, the source of truth must be centralized and not on a local desktop installation.

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

### Rationale

A PWA allows covering PC, mobile, and tablet without building a separate desktop application. The user can open the app from the browser or install it as a shortcut/application from the compatible operating system.

Supabase accelerates the MVP because it provides Postgres, authentication, APIs, storage, local environment, and migration tools without building all the infrastructure from scratch.

### Important Decision

The MVP must not become an irreversible dependency on Supabase. Code decisions should facilitate a future migration to native AWS.

---

## 4. MVP Technology Stack

| Area | Technology | Decision |
|---|---|---|
| Web framework | SvelteKit | Main application framework |
| Language | TypeScript | Mandatory for frontend and minimal server-side logic |
| App type | PWA | Installable web, responsive and usable on PC/mobile/tablet |
| Runtime | Node.js LTS | For SvelteKit server-side when appropriate |
| Package manager | pnpm | Only allowed package manager |
| Initial backend | SvelteKit server actions / API routes | Only for sensitive logic or minimal endpoints |
| Database | Supabase Postgres | Main relational database for the MVP |
| Authentication | Supabase Auth | Login, sessions, and MVP users |
| Authorization | RLS + server-side logic | Row Level Security in Supabase and additional server-side controls |
| Storage | Supabase Storage | Files, vouchers, receipts, or attachments for the MVP |
| Validations | Zod | Form validation, DTOs, and input data |
| Styles/UI | Tailwind CSS or custom CSS | Define before implementing large-scale screens |
| Testing | Vitest / Playwright | Unit tests and end-to-end tests when applicable |
| Local development | Supabase CLI + Docker | Reproducible local stack |
| CI/CD | GitHub Actions | Automated checks per PR/push |
| Local security | Gitleaks / ESLint / TypeScript checks | Prevention of basic errors and secrets |

---

## 5. Technologies Not Used in the MVP

### Tauri

Will not be used in the MVP.

Reason:

- The current goal is a webapp/PWA, not an installable desktop application.
- Adds per-OS builds.
- Adds installer distribution.
- Adds desktop update maintenance.
- Does not eliminate the need for a backend/centralized database.

Tauri will only be reconsidered if a concrete need arises:

- Strong offline usage.
- Advanced access to local printers.
- Access to local hardware.
- Native integration with Windows/Linux/macOS.
- Mandatory installer for a station PC.

### Rust

Will not be used as the main backend for the MVP.

Reason:

- The MVP needs development speed.
- The app is primarily administrative and transactional.
- TypeScript allows sharing language between frontend, validations, and minimal server-side.
- Rust can be incorporated later if a real technical need arises.

### Complex Custom Backend

A separate API will not be built from day 1 unless the scope changes.

Reason:

- SvelteKit server actions/API routes are sufficient to encapsulate sensitive MVP operations.
- Supabase already provides Auth, Postgres, APIs, and Storage.
- Creating a full custom API before validating the product would increase initial cost.

---

## 6. Intended Use of Supabase in the MVP

Supabase should be used as an MVP accelerator, not as a place to hide critical logic without documentation.

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

### Allowed Components with Caution

```txt
Supabase Edge Functions
Supabase Realtime
Complex Postgres triggers
SQL functions with heavy business logic
```

Use them only if they solve a concrete problem. If used, they must be documented.

### Components to Avoid Initially

```txt
Critical business logic distributed across frontend, RLS, triggers, and Edge Functions without documentation
Use of service_role key on the client
Strong dependencies on proprietary APIs if a simple alternative exists
Designs that make migration to RDS PostgreSQL difficult
```

---

## 7. Security Rules for Supabase

### Mandatory Rules

- Never expose `SUPABASE_SERVICE_ROLE_KEY` in the browser.
- The `service_role key` may only exist in a secure server-side environment.
- All tables exposed from the client must have RLS enabled.
- RLS policies must be versioned as SQL migrations.
- Application roles must be explicitly modeled.
- Permissions must not rely solely on hiding buttons in the UI.
- Every sensitive change must leave an audit trail.
- Payments, receipts, transactions, and settlements must not be physically deleted without an explicit audit decision.

### Initially Expected Roles

Exact names may change, but the model must contemplate at least:

```txt
admin
operator
treasurer
collector
read-only
```

### Suggested Permission Model

```txt
admin:
  full functional access, except irreversible destructive operations if decided to restrict them

operator:
  operational creation/editing of members, buyers, raffles, and payments according to defined rules

treasurer:
  financial reports, settlements, reconciliations, payment control

collector:
  limited access to their portfolio, assigned payments, and permitted records

read-only:
  read-only, with defined scope
```

### Minimum Audit

Every sensitive operation should record:

```txt
user
date/time
action
affected entity
entity id
previous value when applicable
new value when applicable
operation source
```

---

## 8. Data Design

### Principles

- Use relational PostgreSQL as the source of truth.
- Version all schema changes through migrations.
- Prefer real referential integrity with foreign keys.
- Use constraints for invariant rules.
- Avoid critical logic only on the frontend.
- Avoid physical deletes on economic entities without proven need.

### Expected Entities

The final model may change, but the domain should contemplate:

```txt
users / profiles
roles
permissions
members
buyers
collectors
raffles
bonds
numbers
sales
payments
receipts
transactions
settlements
reports
audit_log
files / vouchers
```

### Modeling Criteria

- Payments must be traceable.
- Receipts must have unique numbering or identifier.
- State changes must be recorded.
- Financial reports must be reconstructable from transactional data.
- Historical operations must not depend on current values that may change.

Example: if a collector's name changes, a historical receipt should not lose context.

---

## 9. PWA

The app will be a PWA from the MVP.

### Objectives

- Installable from the browser when the device allows it.
- Responsive for PC, mobile, and tablet.
- Fast loading.
- App-like experience.
- Partial offline only for assets and permitted screens.

### Initial Offline Scope

For the MVP, offline should be limited.

Initially allowed:

```txt
static asset caching
friendly error screen without connection
possible access to last non-sensitive views if decided to implement
```

Not recommended initially:

```txt
offline payment loading
offline synchronization of economic operations
offline conflict resolution
complex local transactional database
```

Reason: economic and administrative operations must maintain strong consistency. Real offline can become one of the most complex problems in the system.

---

## 10. Initial Backend with SvelteKit

The MVP can use SvelteKit as a lightweight full-stack application.

### Use Server-Side For

- Sensitive validations.
- Operations requiring `service_role`.
- Receipt or document generation if applicable.
- Queries that should not be directly exposed to the client.
- Report aggregations.
- External integrations.
- Administrative actions.

### Do Not Use Server-Side For

- Unnecessarily duplicating everything Supabase can securely handle with RLS.
- Creating a large API before validating the MVP.
- Mixing business logic directly into visual components.

### Architecture Rule

Business logic must stay out of UI components.

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

Must always exist and must not contain real secrets.

Expected variables for MVP:

```env
PUBLIC_SUPABASE_URL=
PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
APP_ENV=local
```

Rules:

- `PUBLIC_*` may be available on the client.
- `SUPABASE_SERVICE_ROLE_KEY` must never be available on the client.
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

### Expected Workflow

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

### Diagnostics

A diagnostic script must exist:

```bash
./scripts/doctor.sh
```

The script should verify at minimum:

```txt
node
pnpm
docker
supabase CLI
expected environment variables
local Supabase connection
```

---

## 14. CI/CD

### Minimum Validations on Pull Request

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
- All architecture modifications must be documented.

---

## 15. Instructions for AI Agents

AI agents must follow these rules:

### Before Modifying Code

- Read `README.md`.
- Read this document.
- Read `AGENTS.md` if it exists.
- Inspect real files before proposing changes.
- Do not assume modules, folders, or scripts exist that are not in the repository.

### During Development

- Prefer small, reviewable changes.
- Do not introduce dependencies without justification.
- Do not change the technology stack without asking for confirmation.
- Do not add Tauri.
- Do not add Rust.
- Do not create a separate backend unless explicitly requested.
- Do not remove Supabase from the MVP.
- Do not expose private keys on the client.
- Do not weaken RLS to "make it work quickly".

### After Modifying Code

Run or clearly indicate if unable to run:

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
how to test it
```

---

## 16. Code Conventions

### TypeScript

- Strict TypeScript whenever possible.
- Avoid `any` unless specifically justified.
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
- Foreign keys where appropriate.
- Indexes for frequent searches.
- Auditing for sensitive entities.

---

## 17. Post-MVP Strategy: Migration to Native AWS

Once the MVP is validated, the target architecture will be:

```txt
SvelteKit PWA
        |
        v
Custom API
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

| Area | Target Technology |
|---|---|
| Web/PWA | SvelteKit + TypeScript |
| API | Custom API in Node.js/TypeScript initially, unless decided otherwise |
| Database | Amazon RDS PostgreSQL |
| Files | Amazon S3 |
| Authentication | Amazon Cognito or defined OIDC/SAML integration |
| Authorization | Custom API + roles/permissions + IAM where appropriate |
| Secrets | AWS Secrets Manager |
| Logs/monitoring | CloudWatch |
| Infrastructure | Terraform |
| CI/CD | GitHub Actions |
| Security | IAM least privilege, WAF if applicable, backups, auditing |

### Rules to Facilitate Migration

These rules must be respected from the MVP:

- Keep business logic out of UI components.
- Encapsulate Supabase access in specific modules.
- Do not scatter queries throughout the application.
- Maintain clear SQL migrations.
- Avoid Edge Functions unless there is a real need.
- Avoid complex triggers as a replacement for domain services.
- Do not depend on proprietary features if standard PostgreSQL suffices.
- Separate domain model from specific SDKs.
- Document all RLS policies.
- Maintain a repository/service layer that can later point to a custom API.

---

## 18. Known Risks

### Risk: Supabase as a Strong Dependency

Mitigation:

- Keep domain decoupled.
- Do not overuse Edge Functions.
- Version SQL.
- Document RLS.
- Design with standard PostgreSQL in mind.

### Risk: Poorly Designed RLS

Mitigation:

- Enable RLS from the start.
- Review policies in PRs.
- Create permission tests.
- Use explicit roles.
- Do not rely solely on UI.

### Risk: Overly Ambitious Offline

Mitigation:

- Partial offline in MVP.
- Do not record payments offline initially.
- Do not synchronize economic operations until there is a formal design.

### Risk: Inconsistent Reports

Mitigation:

- Use transactional data.
- Do not overwrite history.
- Audit transactions.
- Design states and monthly closings carefully.

### Risk: Underestimated Future Migration

Mitigation:

- Define Supabase usage limits from now.
- Document which part AWS would replace.
- Avoid unnecessary couplings.

---

## 19. Recorded Explicit Decisions

### Decision 1: MVP WebApp/PWA

A webapp/PWA will be built to cover PC, mobile, and tablet without a separate desktop application.

### Decision 2: Supabase to Accelerate MVP

Supabase will be used for Auth, Postgres, Storage, and local environment during the MVP.

### Decision 3: No Tauri in MVP

Tauri is ruled out until there is a real desktop need.

### Decision 4: No Rust in MVP

Rust is ruled out of the MVP to prioritize development speed and simplicity.

### Decision 5: No Complex Custom Backend from Day 1

SvelteKit server-side and Supabase will cover initial needs. A custom API will be evaluated after the MVP.

### Decision 6: AWS as Post-MVP Destination

The post-MVP architecture targets AWS with custom API, RDS PostgreSQL, S3, Cognito/IAM, Secrets Manager, CloudWatch, and Terraform.

---

## 20. Relationship with Current Project README

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

In particular, any instruction assuming `src-tauri`, `cargo`, `rustfmt`, `clippy`, or `pnpm tauri:dev` must be removed or moved to historical documentation.

---

## 21. Target MVP Commands

Exact commands may be adjusted when initializing the project, but the recommended contract is:

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

A task is considered done when:

- The code compiles.
- TypeScript reports no errors.
- Relevant tests pass.
- There are no new secrets.
- Migrations are versioned.
- Affected RLS policies are documented.
- The UI works on desktop and mobile when applicable.
- Documentation was updated if architecture, commands, or variables changed.
- The change does not introduce Tauri, Rust, or complex custom backend without explicit approval.

---

## 23. Pending Questions

Before fully closing the MVP architecture, the following remains to be defined:

- Initial hosting for SvelteKit: AWS, Vercel, Netlify, or other.
- Whether SvelteKit will run with SSR or as a primarily static app.
- Supabase plan for production.
- Supabase region.
- Definitive role model.
- Exact audit rules.
- Whether receipts will be printable HTML, PDF, both, or persistent storage.
- Whether there will be email/WhatsApp integration.
- Backup and recovery strategy.
- Exact timing for migrating to native AWS.

---

## 24. Guiding Principle

The MVP priority is to build a useful, secure, and maintainable application, without over-engineering.

Practical rule:

```txt
First validate the product.
Then harden the architecture.
Finally migrate or scale infrastructure if real usage justifies it.
```
