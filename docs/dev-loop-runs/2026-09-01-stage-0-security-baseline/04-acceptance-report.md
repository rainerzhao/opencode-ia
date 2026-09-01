# Stage 0 acceptance report

## Verdict

**PASS_WITH_NOTES — approved for public first-version demonstration on Mac.**

It is not approved as the final internal multi-user production system because authentication, authorization, durable audit and the Linux/internal-model environment are later stages.

## Automated verification

- `npm test`: 63 passed, 0 failed.
- `npm run check`: 17 project JavaScript files passed syntax validation.
- `npm run security:scan`: no findings; output does not reveal candidate values.
- Independent reviews: Tasks 1, 2, 3 and 4 reached PASS after required fix loops.

## Browser verification

- Home page: loaded at 1440x900 with connected state and safe model badge.
- AI page: normal fake OpenCode message returned; delayed message produced a safe timeout error.
- Knowledge page: three existing example documents rendered.
- Mobile: home, AI and knowledge pages checked at 390x844.
- Layout: no body/root horizontal overflow at either viewport.
- Console: no collected browser errors.
- Screenshots: `artifacts/screenshots/home.png` and `artifacts/screenshots/knowledge.png`.

## Security acceptance mapping

- Shell/CLI input boundary: real child-process metacharacter and leading-dash tests.
- Process containment: timeout, abort, combined output limit, SIGTERM/SIGKILL and streaming tests.
- Session isolation: global and per-WebSocket admission tests; disconnect/shutdown cancellation.
- File containment: traversal, absolute path, NUL, Windows separator and symlink tests.
- Upload safety: fixed staging, pre-validation, cleanup and rollback tests.
- URL import: default deny, allowlist, DNS address policy, fixed validated target, redirect revalidation, size/timeout/abort tests.
- Secret hygiene: repository scan plus safe `.env.example`; local operator handoff file is excluded from Git.

## Notes and follow-ups

1. Browser chat used the deterministic fake OpenCode fixture. The real configured Provider must be acceptance-tested for latency and model response before internal rollout.
2. The accelerated preview did not perform the optional temporary `shell:true` mutation exercise; the committed real-process regression suite covers the same boundary and passed.
3. Rotate the historically exposed Provider API key outside this repository.
4. Implement the approved username/password, admin/member roles, SQLite audit and private-by-default publication model before production use.
