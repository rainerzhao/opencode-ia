# Stage 4D Skill Version Governance Implementation Plan

**Goal:** Deliver private successor drafts, explicit member upgrade/rollback, disable/archive governance, and OpenCode discovery acceptance.

**Architecture:** SQLite remains the lifecycle source of truth. A Skill keeps one stable identity; versions are immutable once published, with one active `published` release and retained `retired` releases. Installation service swaps an account-scoped package before atomically changing the selected version, resets it to `installed`, and requires the existing OpenCode gate to re-enable it.

## Tasks

### 1. Version contract and store

- Add unit tests first in `test/skills/skill-version-governance.test.js` for clone/immutability, version numbering, publish succession, listable retained releases, owner/admin authorization, disabled/archive transitions and per-user selection.
- Confirm RED with `node --test test/skills/skill-version-governance.test.js`.
- Extend `src/skills/skill-store.js` with actor-aware current detail resolution, version list/candidates, successor creation, publish succession, version selection, disabling and archive-after-disable.
- Confirm GREEN with the focused store suites.

### 2. Atomic account installation switching

- Add focused tests in `test/skills/skill-installation-service.test.js` for upgrade, rollback, stale/dangerous targets, reset-to-installed, fresh validation, and filesystem compensation.
- Confirm RED, then extend `src/skills/skill-installation-service.js` to swap a managed package and update the selected release only after disk success; restore the old package on database failure.
- Confirm GREEN and ensure existing 4C install/enable behavior remains compatible.

### 3. HTTP contracts, audit and revocation

- Add API tests to `test/api/skill-version-governance.test.js` for private draft successor, publish, upgrade/rollback, disabled denial, archive, CSRF and audit metadata.
- Confirm RED, then add explicit version/governance routes in `src/modules/skills/routes.js`; map stable errors and add metadata-only audit actions.
- Wire revocation through the existing workspace preparation path: `listEnabledInstallations` must exclude disabled skills so every post-disable Conversation preparation atomically removes it from `.opencode/skills`.
- Confirm GREEN with focused API and workspace sync tests.

### 4. Product UI and real acceptance

- Add UI render tests covering successor-draft, installed target version, upgrade/rollback controls and disabled/archived catalog states.
- Update `apps/web/src/features/skills/SkillsPage.jsx` and styles as needed, keeping ordinary-member and owner governance controls distinct.
- Run real OpenCode discovery for initial enable, upgrade, rollback and disable; another member remains isolated.
- Run `npm test`, `npm run build`, `npm run check`, `npm run security:scan`, `git diff --check`, browser desktop/mobile checks; write acceptance and HTML summary.
- Update `README.md` and `docs/ROADMAP.md`, commit in Chinese and push `main` only after fresh evidence.

## Risks

- "Latest row" SQL must not leak a private successor draft to the team catalog or make an older selected install unenableable.
- A package swap cannot leave DB metadata pointing to content from another release if persistence fails.
- Disable must not delete arbitrary workspace data; sync may only replace its managed `.opencode/skills` subtree.
