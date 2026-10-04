# Quick Logs → rich "Testing Cycles" table — Design

Date: 2026-10-05
Status: Approved for implementation

## Goal

Upgrade the **Quick Logs** tab of the Test Runs screen so it renders manual
test cycles as the rich table from the mockup (the "SimpliEd QA Console /
Testing Cycles" artifact), with a slide-over "Log a test cycle" form, Jira
parent→children fetching, and Excel bulk import/export.

The tab **keeps the name "Quick Logs"** and **shows only manual cycles**
(`mode = 'Manual'`). The separate "Runs" tab (case-based cycles) is unchanged.

## Decisions (confirmed with user)

- Tab name stays **"Quick Logs"**; the row-card list is replaced by the table.
- Data scope: **manual cycles only**.
- Add new fields **`outcome`** (Open/Pass/Fail) and **`testRunLink`**.
- Bulk insert/export via **Excel (.xlsx)** plus a downloadable **sample template**.
- Form is a **right-side slide-over**; it **replaces** the current quick-log
  create/edit modals with one unified form.
- A best-effort **"Sync from Jira"** header action re-syncs manual cycles that
  carry a ticket.

## What already exists (reused, not rebuilt)

- **Jira parent→children fetch**: `lib/jira.ts#syncFromJira` fetches the parent
  ticket, pulls all sub-issues, buckets severity (Critical/Major/Minor),
  tallies done/remaining/reopened, returns per-child info. Exposed at
  `POST /api/projects/[id]/integrations/jira/fetch`. No change needed.
- **`TestCycle` model** already has module/feature/env/platform/version/
  cycleCategory/ticketLink/severity counts/open count/loggedBy.
- **xlsx + CSV libs**: `lib/export.ts` (xlsx writer), `lib/csv.ts`,
  `ImportCsvModal.tsx`, test-case import routes.
- **Deploy schema sync**: `docker-entrypoint.sh` always runs
  `prisma db push` (additive, non-destructive); `SEED_DATA=true` runs the
  idempotent seed.

## Data model

Two new **nullable** columns on `TestCycle` (`prisma/schema.prisma`):

- `outcome String?` — `"Open" | "Pass" | "Fail"`. Null on existing rows → the
  UI derives a display value from counts (0 open issues → Pass, else Fail;
  Open when explicitly in progress). New/edited cycles store it explicitly.
- `testRunLink String?` — external test-run URL, separate from `ticketLink`.

`loggedBy` already exists; it becomes editable (QA Engineer field).

### Migration & seed (SEED_DATA requirement)

- New migration `prisma/migrations/20261207000000_cycle_outcome_testrun_link/migration.sql`
  with two `ALTER TABLE "test_cycles" ADD COLUMN` statements (dev
  `prisma migrate` convention).
- Prod: `prisma db push` applies the two nullable columns to existing DBs with
  no data loss — already wired in the entrypoint.
- `prisma/seed.js`: add an **idempotent backfill** that sets `outcome` on
  existing manual cycles where null (derived from counts), and seeds 1–2 sample
  manual cycles so the table isn't empty on a fresh seed. Safe to re-run.

## API

- `POST /api/cycles` + `PATCH /api/cycles/[id]`: accept `outcome`,
  `testRunLink`, `loggedBy`.
- `createCycle` in `hooks/useStore.ts`: let a form-supplied `loggedBy` win over
  the session default (currently the session value always overrides).
- **New** `POST /api/cycles/import`: body `{ projectId, rows[] }`. For each row,
  resolve Portal/Module/Feature **by name** to a real `scopeId` when it matches
  the workspace hierarchy (so imported cycles feed Stability); otherwise store
  as free text. Creates `mode: 'Manual'` cycles. Returns
  `{ created, skipped, errors[] }`. Reuses the `nz()` clamp pattern.

## UI — Quick Logs tab (`components/features/TestRunsBoard.tsx`)

Replace the Quick Logs row-card branch with:

- **Filters bar** (client-side, from the existing `cycles` prop): Period
  (All time / custom range) · Module dropdown · Engineer dropdown · Portal
  chips (All + one per portal).
- **Table** columns: Date · Module · Feature · Env · Type · Ticket (Jira link
  via `JiraTicketLink`) · Issues (severity dots) · Open · Outcome badge.
  Row click → existing `CycleInfoModal`; pencil → edit form; trash → delete.
- **Header actions**: `+ New cycle` (slide-over), `Import`, `Export`, `Sample`,
  and `Sync from Jira` (best-effort, when Jira connected).

## UI — "Log a test cycle" slide-over (new component)

Right-side slide-over used for create and edit of manual cycles, matching the
mockup. Fields: Date\*, Module\*, Feature (follows module), Environment, Cycle
Type, Platform, Version, Parent Ticket (+ Sync from Jira), Outcome, QA Engineer
(editable), Severity breakdown (Critical/Major/Minor + live Total), Open Issues,
Ticket Description + Auto-fill (composes role·module·feature·type), Test-Run
Link, Notes/Feedback. Preserves Jira sync, counters, done/remaining.

## Import / Export / Sample (Excel)

- `lib/export.ts#exportCycles(rows)` → `.xlsx` of currently-filtered cycles.
- `lib/export.ts#downloadCycleSampleTemplate()` → `.xlsx` with header row +
  2 example rows + a comment/instructions row.
- Import modal: upload `.xlsx`, parse with `xlsx`, preview summary, then
  `POST /api/cycles/import`.
- Column set (export, sample, import): Date, Portal, Module, Feature,
  Environment, Cycle Type, Platform, Version, Parent Ticket, Outcome,
  QA Engineer, Critical, Major, Minor, Open Issues, Test-Run Link, Notes.

## Types

Add `outcome?: string | null`, `testRunLink?: string | null` to `TestCycle`
(`types/index.ts`) and to `CycleFormPayload` (`NewCycleModal.tsx`), plus
`loggedBy`.

## Outcome derivation (shared helper)

`deriveOutcome(cycle)`:

- explicit `outcome` when set;
- else `"Pass"` when issueCount > 0 and remaining == 0 (or issueCount == 0);
- else `"Fail"` when remaining > 0;
- `"Open"` is only an explicit, user-chosen state.

## Testing

- Unit: outcome derivation; import row→payload mapping + name resolution;
  xlsx round-trip (export rows → parse → same values).
- `npm run typecheck` and `npm run lint` clean.
- Manual verification of create / edit / Jira sync / import / export / sample
  in the running app.

## Out of scope

- Renaming the tab, unifying case-based runs into this table, non-Excel import
  formats, changes to the Runs tab or the Analytics Cycle History report.
