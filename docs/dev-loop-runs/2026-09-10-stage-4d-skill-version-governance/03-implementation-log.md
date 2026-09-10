# Implementation Log

## 1. Version lifecycle and catalog resolution

- Added immutable successor drafts on the same stable Skill id. A published `0.1.0` release clones to a private `0.2.0` draft with its controlled files; the published release remains the normal team catalog result.
- Publishing a validated successor retires the former active release and retains it for explicit rollback. Existing member installations are intentionally unchanged.
- Added actor-aware release queries, including a regression test ensuring even the owner sees the active published release in the team catalog while editing a private successor.

## 2. Member version selection and package safety

- Added upgrade and rollback actions. A selected target release atomically replaces the account-scoped managed package, updates only that member's installation, and resets it to `installed`.
- Reused the enable-time OpenCode validation gate after every version change; an enabled state can never be carried across a content switch.
- Added an explicit atomic `replacePackage` primitive: it verifies the previous package, writes/validates a protected temporary package, renames it into place, and restores the prior package if persistence fails.

## 3. Governance and Runtime cache boundary

- Added disable and archive API/store actions. Disable revokes all enabled installations; archive is allowed only after disable and retains history.
- Real acceptance discovered that OpenCode 1.18.25 can retain a `/skill` directory result for an already-used workspace. Gateway now derives a non-secret workspace key from the enabled Skill set and creates a new Session binding when that key changes. This prevents an existing Conversation from continuing under a stale discovered Skill set.
- Workspace synchronization remains limited to the managed `.opencode/skills` subtree and never recursively deletes other Conversation artifacts.

## 4. HTTP and browser product surface

- Added successor, release-list, upgrade, rollback, disable and archive endpoints, with existing session/CSRF protection and metadata-only audit records.
- Updated the Skill screen with owner/admin governance controls, visible release choices, member upgrade/rollback actions, and non-runnable disabled state.
- Passed browser interaction using the isolated demo: create private draft, validate, publish, create `0.2.0` successor. Screenshots are in `artifacts/screenshots/`.

## TDD evidence

- `test/skills/skill-version-governance.test.js` initially failed because successor/governance methods were absent; it now passes.
- `test/skills/skill-installation-service.test.js` exposed that the immutable Stage 4C write API correctly rejected a different version; the dedicated atomic replacement implementation and tests now pass.
- `test/integration/skill-version-discovery.test.js` initially exposed stale OpenCode directory discovery in a reused workspace; the workspace-key/rebinding change is covered by `test/gateway/gateway-service.test.js` and the real acceptance now passes.
