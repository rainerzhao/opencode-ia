# P1C-A Controlled Requirement Intake Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a private, typed field-template/value foundation for requirement intake.

**Architecture:** SQLite and MySQL receive matched version-13 schema migrations. A shared input normalizer owns schema/value validation; both repositories expose the same template/value operations, while the requirements router exposes owner/admin-guarded HTTP contracts and audit-safe metadata.

**Tech Stack:** Node.js CommonJS, Express, better-sqlite3, MySQL, node:test.

**Spec:** `docs/dev-loop-runs/2026-09-14-p1c-requirement-intake/00-requirements.md`

## Global Constraints

- All data remains owner-private unless future explicit sharing is added.
- MySQL is the production path; SQLite must retain behavioral parity.
- No model API may be called in this slice.
- Tests are written and observed failing before production behavior is added.

---

### Task 1: Versioned schema and input contract

**Files:**
- Modify: `src/db/migrations.js`
- Modify: `src/db/mysql-migrations.js`
- Create: `src/requirements/requirement-fields.js`
- Test: `test/requirements/requirement-fields.test.js`

**Interfaces:**
- Produces `normalizeFieldTemplate`, `normalizeFieldValue`, and `normalizeFieldValueEntries`.

- [ ] Write type/options/identifier validation tests and observe failure.
- [ ] Add strict SQLite and InnoDB MySQL migrations for template and value tables.
- [ ] Add the shared normalizer and run the focused test green.

### Task 2: Repository behavior

**Files:**
- Modify: `src/requirements/requirement-store.js`
- Modify: `src/requirements/mysql-requirement-store.js`
- Test: `test/requirements/requirement-store.test.js`
- Test: `test/requirements/mysql-requirement-store.test.js`

**Interfaces:**
- Produces administrator template CRUD/archive, active-template list, and atomic owner value replacement on create/update.

- [ ] Add failing owner-isolation and typed-value persistence tests.
- [ ] Implement SQLite repository behavior, then MySQL parity.
- [ ] Run focused repositories green.

### Task 3: HTTP and product documentation

**Files:**
- Modify: `src/modules/requirements/routes.js`
- Test: `test/api/requirement-routes.test.js`
- Modify: `README.md`
- Modify: `docs/ROADMAP.md`
- Modify: `docs/PRODUCT_GOAL.md`

**Interfaces:**
- Produces admin template routes and owner-safe values through existing requirement routes.

- [ ] Add route tests that verify authorization and audit redaction.
- [ ] Implement routes and run focused tests green.
- [ ] Update product status without overstating P1C-B OpenCode integration.

### Task 4: Acceptance and release

- [ ] Run relevant SQLite tests, opt-in MySQL tests when configured, `npm run check`, `npm run build`, security scan, and diff check.
- [ ] Record exact results in `03-implementation-log.md` and `04-acceptance-report.md`.
- [ ] Commit in Chinese and push `main`.
