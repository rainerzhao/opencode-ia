# Requirements Baseline

## Goal

Complete Stage 4D on the Mac: immutable Skill releases can evolve through private successor drafts; members may deliberately upgrade or roll back their own installation; owners or administrators can disable and archive a team Skill without deleting history.

## Non-goals

- No Linux deployment, OS-level sandbox, company SSO, or direct model API access.
- No automatic fleet upgrade, permanent delete, or administrator access to private Conversation bodies.
- No claim that a Mac acceptance run proves production capacity or Linux security.

## User-visible Behavior

- The owner/admin can create a new private version from the currently published package. The published package remains immutable and usable while the draft is edited and validated.
- Publishing the successor makes it the catalog default while retaining earlier releases for an explicit member rollback.
- An installed member selects an available release to upgrade or roll back. Either action returns the installation to `installed`; a fresh OpenCode validation is required before `enabled` again.
- An owner/admin can disable a team Skill. New install/enable/version-change requests fail, enabled installations become disabled, and the next workspace preparation atomically replaces its discovered Skill tree with the permitted set.
- An owner/admin can archive a disabled team Skill. It remains retained for governance/audit and is not permanently deleted.

## Acceptance Criteria

1. A successor draft clones package content/files without changing the published version; only owner/admin may create it.
2. Each successor version has a deterministic minor increment (`0.1.0` to `0.2.0`) and does not change the stable Skill id or slug.
3. Only a validated successor can publish; the prior active release is retained as `retired`, while new installs resolve to the new `published` release.
4. Upgrade/rollback update only the caller's installation, atomically replace the managed package, require a new runtime validation to enable, and compensate disk changes if persistence fails.
5. Disabled/archived Skills cannot be installed, enabled, upgraded, or rolled back. Disabling revokes enabled state and removes the Skill from a freshly prepared workspace.
6. All state-changing APIs retain CSRF/auth boundaries and record metadata-only audit events.
7. React exposes the lifecycle clearly at desktop and 390px widths without horizontal overflow.
8. A real OpenCode acceptance proves target-version discovery after upgrade and rollback, isolation for another member, and revocation after disable.

## Constraints

- Default drafts remain private; no source/file content in audit events or public Git.
- All runtime validation and execution pass through OpenCode.
- Existing published installs must remain usable until the member changes version or governance disables the Skill.
- SQLite migrations remain additive, STRICT, foreign-key safe, and safe for existing v4 data.

## Assumptions

- `skills` holds stable catalog metadata; immutable executable content remains versioned in `skill_versions` and `skill_files`.
- A member has one selected installation per Skill. Older releases are retained, not auto-upgraded.
- "Safely remove" means the system disables installation state immediately and atomically materializes no disabled package at every subsequent Conversation workspace preparation; no unmanaged directory is recursively deleted.

## Open Questions

None blocking. The user authorized proceeding directly from one Stage to the next.

## Source Request

User directed the project to continue and previously authorized completing each development stage, committing, pushing, and updating the README when the stage is complete.

## Repo Context

Base commit: `0896390` (`完成 Stage 4C Skill 发布安装与 OpenCode 发现`). Stage 4A–4C are complete on Mac; Stage 4D is the final planned Skill-center substage.
