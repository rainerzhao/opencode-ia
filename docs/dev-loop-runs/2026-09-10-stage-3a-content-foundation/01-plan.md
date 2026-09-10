# Stage 3A Content Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a SQLite-backed, versioned and searchable content foundation for private knowledge and solutions.

**Architecture:** Migration 5 adds normalized content assets and current-version FTS5. A focused `content-store` owns transaction boundaries, immutable version inserts, visibility-filtered reads, safe summaries and deterministic search. Existing file endpoints remain untouched until Stage 3B so the Demo does not change during the schema-only delivery.

**Tech Stack:** Node.js CommonJS, `node:sqlite` `DatabaseSync`, SQLite foreign keys and FTS5, Node test runner.

**Spec:** `docs/dev-loop-runs/2026-09-10-stage-3a-content-foundation/00-requirements.md` and `docs/superpowers/specs/2026-09-01-team-ai-workbench-design.md` section 7.

## Global Constraints

- Default visibility is `private`; this phase has no implicit team publication.
- Content text never enters audit metadata or error messages.
- FTS searches only current knowledge versions and filter private records before returning results.
- Do not alter the behaviour of existing `/api/knowledge/*` or `/api/solutions` endpoints in this phase.
- New code uses CommonJS and no new npm dependencies.

---

### Task 1: Migration 5 content schema and FTS contract

**Files:**
- Modify: `src/db/migrations.js`
- Create: `test/db/content-database.test.js`

**Interfaces:**
- Produces tables `knowledge_documents`, `knowledge_versions`, `solutions`, `solution_versions`, `content_references`, and virtual table `knowledge_fts`.
- Consumes existing `users` and `conversations` primary keys.

- [ ] **Step 1: Write the failing migration test**

```js
assert.deepEqual(migrateDatabase(db), { appliedVersions: [5] });
assert.equal(db.prepare("SELECT name FROM sqlite_schema WHERE name = 'knowledge_fts'").get().name, 'knowledge_fts');
assert.throws(() => db.prepare("INSERT INTO knowledge_versions (...) VALUES (...)").run(), /FOREIGN KEY/);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/db/content-database.test.js`

Expected: migration only applies versions 1–4 and `knowledge_fts` is absent.

- [ ] **Step 3: Add migration 5**

Create strict asset/version/reference tables with `draft|published|withdrawn|archived` status, `private|team` visibility, immutable version rows and the FTS5 virtual table. Add indices for owner/status/current-version lookup.

- [ ] **Step 4: Run migration test to verify it passes**

Run: `node --test test/db/content-database.test.js`

Expected: PASS with migration 5 and constraint assertions.

### Task 2: Versioned content store and ownership-filtered FTS

**Files:**
- Create: `src/content/content-store.js`
- Create: `test/content/content-store.test.js`

**Interfaces:**
- Produces `createContentStore(db, { clock, idFactory })` with `createKnowledgeDraft`, `saveKnowledgeVersion`, `getKnowledge`, `searchKnowledge`, `createSolutionDraft`, `saveSolutionVersion`, `getSolution`, and `listSolutions`.
- Consumes migration 5 schema and returns safe summaries unless `includeContent: true` is explicitly requested by an authorized caller.

- [ ] **Step 1: Write failing store tests**

```js
const item = store.createKnowledgeDraft({ actorUserId: 'member-a', title: 'GPU plan', markdown: '# GPU\nH800', category: 'gpu', tags: ['gpu'] });
assert.equal(store.searchKnowledge({ actorUserId: 'member-b', query: 'H800' }).length, 0);
store.saveKnowledgeVersion({ actorUserId: 'member-a', documentId: item.id, markdown: '# GPU\nH800 80GB' });
assert.equal(store.getKnowledge({ actorUserId: 'member-a', documentId: item.id, includeContent: true }).version, 2);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/content/content-store.test.js`

Expected: module does not exist.

- [ ] **Step 3: Implement minimum store**

Use `BEGIN IMMEDIATE` around asset/current-version changes; insert a new immutable version, point the asset at it, replace only its FTS row, and expose metadata-only list/search values by default. Reject unauthorized IDs with a typed `CONTENT_NOT_FOUND` error to avoid existence leaks.

- [ ] **Step 4: Run store tests to verify they pass**

Run: `node --test test/content/content-store.test.js`

Expected: PASS for private isolation, team visibility, immutable version history, current-version FTS and solution source references.

### Task 3: Wire the content store at application construction and document delivery

**Files:**
- Modify: `src/create-workbench-server.js`
- Modify: `README.md`
- Modify: `docs/ROADMAP.md`
- Modify: `docs/dev-loop-runs/2026-09-10-stage-3a-content-foundation/03-implementation-log.md`

**Interfaces:**
- `createWorkbenchServer` initializes the Store after migration so later Stage 3 routers share one authoritative constructor.
- README and roadmap state that only Stage 3A data foundation is complete; publishing, source conversion and backup remain pending.

- [ ] **Step 1: Write the failing integration assertion**

```js
assert.ok(fixture.workbench.contentStore);
assert.equal(fixture.workbench.contentStore.searchKnowledge({ actorUserId: member.id, query: 'x' }).length, 0);
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `node --test test/api/content-foundation.test.js`

Expected: `contentStore` is not exposed by the workbench.

- [ ] **Step 3: Initialize and expose the store without changing legacy route behavior**

Construct the store from the migrated database and return it with other explicitly testable workbench services. Update product documentation precisely.

- [ ] **Step 4: Run focused tests and product checks**

Run: `node --test test/db/content-database.test.js test/content/content-store.test.js test/api/content-foundation.test.js && npm test && npm run build && npm run check && npm run security:scan && git diff --check`

Expected: all commands exit 0.

## Self-review

- Schema covers content identity, immutable history, ownership, visibility, current-version lookup, FTS and source references.
- Store owns SQL writes and does not leak private text in default values or errors.
- Existing HTTP flows are intentionally untouched and are protected by full regression.
- Placeholder scan: no TBD/TODO/unspecified validation steps remain.
