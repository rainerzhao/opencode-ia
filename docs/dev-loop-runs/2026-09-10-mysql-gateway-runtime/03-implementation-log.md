# Implementation Log

## Task 1: MySQL Gateway Store contract

- RED: the real-MySQL Gateway Store test failed with `store.attachJobBinding is not a function`.
- GREEN: added asynchronous queue, recovery, metadata, Conversation lifecycle, event-cursor and Job-binding methods with the SQLite Store contract as the behavioral reference.
- Test fixture is now re-runnable: it removes only its two explicit test users before reseeding, and assertions check local event monotonicity rather than a database-global sequence beginning at one.
- Verification: `npm test`, the real-MySQL contract test, `npm run build`, `npm run check`, and `npm run security:scan` all exited successfully.
- Boundary: this is the durable Store phase only. Gateway Service execution, administration routes and final MySQL-only application composition remain subsequent tasks.

## Task 2: Asynchronous Gateway runtime

- RED: an asynchronous Store could accept a Job but left it `running`, because Session, Conversation, binding, event and completion calls were still treated as synchronous.
- GREEN: Gateway execution, fair selection, cancellation, recovery, Worker status updates and event replay now await durable operations while keeping the established synchronous SQLite adapter behavior.
- RED: real MySQL execution remained `queued` when a deliberately delayed Worker metadata write raced the first submitted Job.
- GREEN: startup now treats initial Worker metadata persistence as a Gateway readiness condition before it begins scheduling.
- Evidence: the real MySQL acceptance executes one private Conversation through one persistent OpenCode Session and verifies durable Job completion and ordered events.
- Final verification uses serial real-MySQL tests because restart recovery intentionally affects every running Job and active Session in the configured database. The two test fixtures clean only their explicit test users and Worker IDs, so repeated serial runs remain isolated.
