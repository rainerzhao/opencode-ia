# Plan Review Rounds

## Round 1 — inline architecture, product, test and security review

### Verdict

APPROVED

### Resolved findings

- **IMPORTANT / catalog resolution:** a published Skill with a private successor must expose the latest published release to ordinary catalog users, never simply the newest row. The implementation plan requires actor-aware detail/list queries.
- **IMPORTANT / no forced upgrade:** release publication must not rewrite another member's selected version. The plan keeps installations immutable until a deliberate upgrade/rollback request.
- **IMPORTANT / revocation boundary:** disable changes persisted installation state immediately and relies on the existing atomic workspace sync to remove only its managed discovered tree on next preparation; no broad workspace deletion.
- **IMPORTANT / verification:** version switch resets to installed and must pass the same runtime validation gate before it becomes enabled.
- **QUESTION / archive semantics:** archive is permitted only after disable so existing installations cannot remain runnable under an archived catalog entry.

### Remaining NITs

- A future Stage 5 deployment can add asynchronous sweep/notification for currently idle workspaces; it is not needed for the safe next-run revocation contract.
