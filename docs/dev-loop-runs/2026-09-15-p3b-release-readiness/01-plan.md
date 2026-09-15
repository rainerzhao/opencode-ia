# P3B Release Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a safe, reusable preflight report from the existing production and Provider gates without starting the service or revealing sensitive configuration.

**Architecture:** `scripts/collect-production-readiness.js` is a deep Module with one Interface: `collectProductionReadiness(options)`. It invokes both existing gate adapters independently, projects their successful results into fixed safe metadata, projects failures into known codes/messages, and returns a frozen report. Its CLI prints JSON and exits non-zero only when the report is not ready.

**Tech Stack:** Node.js CommonJS, existing production/Provider gate Modules, Node test runner.

**Spec:** `docs/dev-loop-runs/2026-09-15-p3b-release-readiness/00-requirements.md`

## Global Constraints

- Never print connection URLs, credentials, file paths, or raw environment values.
- Evaluate both gate adapters even when one fails.
- Keep `start:production` unchanged; it remains the service-opening gate.
- Do not treat local report success as a company deployment result.

---

### Task 1: Define and prove the report Interface

**Files:**
- Create: `test/ops/release-readiness.test.js`
- Create: `scripts/collect-production-readiness.js`
- Modify: `package.json`

**Interfaces:**
- Produces: `collectProductionReadiness({ env, projectDir, uid, now, validateProduction, validateProvider })`.
- Returns: frozen `{ schemaVersion: 1, generatedAt, status, checks, summary }`.
- `checks` uses only `id`, `status`, `code`, and safe `message`; `summary` uses only booleans/counts/category names.

- [ ] **Step 1: Write failing tests**

```js
const report = collectProductionReadiness({
  now: () => '2026-09-15T00:00:00.000Z',
  validateProduction: () => ({ database: 'mysql', cookieSecure: true, uid: 1001 }),
  validateProvider: () => ({ providers: ['internal'], model: 'internal/model' })
});
assert.equal(report.status, 'ready');
assert.deepEqual(report.summary, { database: 'mysql', secureCookie: true, nonRoot: true, providerCount: 1 });
assert.doesNotMatch(JSON.stringify(report), /secret|https:|opencode\.json/);
```

Add a second test where both adapters throw errors with explicit codes and private strings; assert both checks are `fail`, their codes survive, and their strings do not.

- [ ] **Step 2: Run the test and verify RED**

Run: `node --test test/ops/release-readiness.test.js`

Expected: fail because `scripts/collect-production-readiness.js` does not exist.

- [ ] **Step 3: Implement the minimal report Module and CLI**

```js
const attempt = (id, callback) => {
  try { return { id, status: 'pass', value: callback() }; }
  catch (error) { return { id, status: 'fail', code: error.code || 'PREFLIGHT_FAILED', message: '检查未通过' }; }
};
```

Call both adapters, project successful values to safe aggregate values, and make the CLI set `process.exitCode = 1` when `status === 'not_ready'` after printing JSON.

- [ ] **Step 4: Run GREEN verification**

Run: `node --test test/ops/release-readiness.test.js`

Expected: all pass.

### Task 2: Expose and document the operator Interface

**Files:**
- Modify: `package.json`
- Modify: `README.md`
- Modify: `docs/operations/company-preflight-handoff.md`
- Modify: `docs/ROADMAP.md`

- [ ] **Step 1: Add `preflight:release` script.**
- [ ] **Step 2: Document it as a local preflight evidence tool, before but not instead of real company tests.**
- [ ] **Step 3: Run `npm run preflight:release` without company configuration.**

Expected: JSON `not_ready`, both checks represented, process exit 1, no sensitive strings.

### Task 3: Verify and release P3B local foundation

**Files:**
- Create: `docs/dev-loop-runs/2026-09-15-p3b-release-readiness/03-implementation-log.md`
- Create: `docs/dev-loop-runs/2026-09-15-p3b-release-readiness/04-acceptance-report.md`
- Create: `docs/dev-loop-runs/2026-09-15-p3b-release-readiness/05-pr-summary.html`

- [ ] **Step 1: Run targeted tests, `npm run build`, `npm run check`, `npm run security:scan`, and `git diff --check`.**
- [ ] **Step 2: Record exact results and the company-environment boundary.**
- [ ] **Step 3: Stage only P3B release-readiness files, commit in Chinese, push `main`, then compare `HEAD` with `origin/main`.**
