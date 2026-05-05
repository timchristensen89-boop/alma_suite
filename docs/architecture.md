# Alma Suite v18 Architecture

## Principles
- Compliance first
- Local first
- Postgres required
- Stable stack over novelty
- Clear separation from Stock

## Repo structure
- `apps/web` React front end
- `apps/api` Express API
- `packages/db` Prisma schema, client, seed
- `packages/shared` shared validation and types
- `packages/ui` lightweight reusable UI primitives
- `scripts` local setup helpers
- `docs` architecture and install notes

## Current module state
### Issues
Fully wired across database, API, shared schemas, and web flows.

### Checklists
Schema foundation in place. Next implementation should expose template CRUD, run flows, item result handling, notes, and linked issues.

### Audits
Schema foundation in place. Next implementation should expose template CRUD, section structured runs, findings, score summaries, and follow up issue links.
