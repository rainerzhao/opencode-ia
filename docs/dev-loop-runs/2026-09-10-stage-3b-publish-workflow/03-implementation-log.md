# Implementation Log

- RED→GREEN Store tests added immutable publish/withdraw versions and list summaries without bodies.
- RED→GREEN API tests added private ownership, CSRF, safe audit records, explicit publish and withdrawal visibility.
- React knowledge and solution pages now use `/api/content/*`; each action opens an in-page confirmation dialog.
- Browser test discovered a hidden confirmation dialog still appeared in the accessibility tree. Root cause: it was rendered with no action target. Fixed by mounting the dialog only after a user chooses publish/withdraw.
- Browser evidence: local Demo created a private knowledge draft, saved it, confirmed publication, and showed team-published v2; 390×844 had no horizontal overflow and browser errors were clear.
