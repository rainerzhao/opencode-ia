# Stage 0 implementation log

## Scope

This run converted the original static prototype into a safer, testable Mac preview baseline without changing the product decision that all inference executes through OpenCode.

## Delivered tasks

1. Portable configuration and path policy — `e87afb0`
   - Added injected project roots, numeric limits, filename validation, containment and symlink checks.
   - Final independent review: PASS; 16/16 at task completion.
2. Bounded OpenCode runner — `ecd23e7`, `90029e3`, `d923ba6`
   - Replaced shell command interpolation with `spawn(..., shell:false)` and explicit `--` option boundary.
   - Added timeout, cancellation, output limit, exit handling, UTF-8 streaming and SIGKILL escalation.
   - Final independent review: PASS.
3. Server lifecycle and WebSocket controls — `27b1b57`, `dda98c6`, `4f30a41`
   - Extracted a testable server factory; added session admission, per-session serialization, safe errors and bounded shutdown.
   - Closed outbound fetches and settled immediate start/stop races.
   - Final independent review: PASS; 41/41 through Task 3.
4. Knowledge, upload and URL security — `19f0038`
   - Unified path enforcement, upload staging/rollback, SSRF/default-deny URL policy, per-hop redirects, DNS/address checks and bounded responses.
   - Defensive independent review: PASS; 60/60 through Task 4.
5. Release hygiene — `dd1f67e`
   - Removed `node-pty`, added standard test/check/secret-scan commands, `.env.example`, `.gitignore` and public README.
   - Final local verification: 63/63; 17 JavaScript syntax checks; zero secret findings.

## Browser acceptance

The Browser Use workflow drove a real Chromium session against the local Express/WebSocket server. Desktop and mobile navigation, normal chat, safe timeout, knowledge content, console errors, screenshots and horizontal overflow were checked.

## Concerns retained

- This preview has no username/password, roles, SQLite persistence or audit trail yet.
- Each message launches one bounded `opencode run`; the persistent Gateway remains Stage 2.
- Provider credentials remain exclusively in OpenCode configuration. A historically exposed Provider key must still be rotated by the operator.
