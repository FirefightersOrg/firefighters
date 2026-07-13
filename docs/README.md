# Documentacion del proyecto

## Objetivo

Esta carpeta contiene el diseno funcional, tecnico y operativo del sistema de gestion de bonos/rifas de Bomberos.

## Lectura recomendada

1. `mvp.md`
2. `functional-design.md`
3. `technical-design.md`
4. `data-model.md`
5. `state-machines.md`
6. `implementation-plan.md`

## Documentos funcionales

- `mvp.md`: alcance de la primera version.
- `functional-design.md`: modulos, roles, pantallas y flujos.
- `screens.md`: pantallas prioritarias y experiencia funcional.
- `draw-rules.md`: reglas de sorteos, padrones y ganadores.
- `documents.md`: remitos y constancias HTML imprimibles.
- `corrections.md`: anulaciones y correcciones auditadas.

## Documentos tecnicos

- `technical-design.md`: arquitectura SvelteKit + Supabase.
- `data-model.md`: entidades, relaciones y constraints.
- `state-machines.md`: estados y transiciones.
- `permissions.md`: roles, permisos y matriz inicial.
- `imports.md`: carga por codigo de barras, archivos y sistema viejo.
- `commissions.md`: reglas, excepciones y ajustes manuales.

## Operacion e implementacion

- `migration.md`: migracion desde sistema antiguo.
- `backup-operations.md`: backups, recuperacion y operacion productiva.
- `implementation-plan.md`: fases de construccion.
- `open-questions.md`: decisiones cerradas y dudas pendientes.

## Criterios clave

- El MVP es web/PWA con SvelteKit, TypeScript y Supabase.
- Los numeros son configurables por campana, no globales.
- Los saldos de cobradores se calculan desde movimientos.
- Las rendiciones cerradas no se reabren.
- Los sorteos usan padrones congelados.
- Las correcciones se hacen con anulaciones o ajustes auditados.
- Los documentos iniciales son HTML imprimibles.
