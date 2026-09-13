# Requirements Baseline — P1C-A Controlled Requirement Intake

## Goal

Add an auditable, private data foundation for administrator-managed requirement field templates and owner-managed field values.  It is the first independently releasable slice of P1C, before asynchronous OpenCode draft generation.

## Non-goals

- Do not call a model provider or create a parallel agent runtime.
- Do not let AI output create, publish, or modify a requirement automatically.
- Do not grant administrators access to a member's private requirement body or field values.
- Do not add arbitrary member-created schemas; only administrators manage team templates.

## User-visible Behavior

- An administrator can create, list, update, and archive controlled templates.
- A member can save values for active templates when creating or updating their own requirement.
- Values are type-checked against the immutable template schema version in effect at save time.
- Reading a requirement returns its values with the corresponding schema snapshot metadata.

## Acceptance Criteria

1. SQLite and MySQL migrations define the same template/value model and constraints.
2. Template keys are unique, valid identifiers; select options are controlled; templates are versioned rather than silently reinterpreted.
3. A value cannot be written for an archived/missing template or with the wrong type/options.
4. Private owner authorization applies to template values as it does to requirements.
5. HTTP routes audit metadata only, never a private value body.
6. Store and HTTP regression tests cover owner isolation, admin-only template writes, type validation, and value persistence.

## Constraints

- Production repository implementation must work with company-cloud MySQL; SQLite is a compatible local/test implementation.
- Existing requirements remain valid and do not require a backfill.
- API is authenticated under existing `/api/requirements` middleware and uses current audit conventions.

## Assumptions

- Template types for this slice are `text`, `number`, `select`, and `boolean`.
- A template archive prevents future values but preserves historic values and their schema version.
- Requirement core fields remain controlled by the existing request contract.

## Open Questions

None blocking. Team-defined freeform fields are intentionally excluded in favor of administrator-governed templates.

## Source Request

Active Goal: controlled custom fields; raw materials, AI drafts, and human confirmations remain separate and traceable. User previously authorized continuous staged development with a Chinese commit and push after each accepted stage.

## Repo Context

Existing `requirements`, `business_units`, `requirement_interactions`, and `requirement_links` are private-owner repositories in SQLite/MySQL with Express routes in `src/modules/requirements/routes.js`.
