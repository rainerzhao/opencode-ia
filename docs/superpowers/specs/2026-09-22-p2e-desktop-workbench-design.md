# P2E Desktop Workbench Experience Design

## Purpose

P2E turns the existing functional React application into a coherent desktop workbench for a 1–20 person cloud-solution team. The workbench must make a member’s next business action, private asset boundary, and OpenCode execution state understandable at a glance. It is not a general AI chat product.

## Confirmed Decisions

- The product is desktop-first: 1280–1920px is the primary design range and 1024px is the minimum usable width. Tablet and phone layouts are out of scope for P2E.
- The visual direction is a restrained mission-control workbench: dark structural chrome, a calm light operational canvas, cyan/teal system signals, and amber for attention. Decorative neon, broad gradients, glass effects, robot imagery, and generic chat bubbles are prohibited.
- OpenCode remains the only Agent Runtime. P2E changes presentation and interaction only; it must not add a browser-to-Provider call path or weaken owner-scoped visibility.
- Existing routes, APIs, form names, authorization boundaries, and lifecycle semantics remain stable. This is a presentation and component-boundary redesign, not a data-model rewrite.

## Users and Primary Jobs

| User | Primary job | The page must answer |
| --- | --- | --- |
| Member | Turn scattered BU communication into a private, actionable requirement and reusable assets | What should I advance now, what evidence is missing, and what can I safely share? |
| Member | Continue a long-running AI-assisted task | Which conversation is active, what context is attached, is execution waiting/running/recovering, and what should I do next? |
| Member | Produce or use a Skill | Is this draft private, validated, published, installed, enabled, or obsolete? |
| Administrator | Govern accounts, controlled fields and runtime health without seeing private content | Is the team system healthy and which control needs attention? |

## Information Architecture

The application keeps its seven existing destinations, but their role in the shell becomes explicit:

1. **工作台首页** — personal command surface: next requirements, clarification work, active contexts, assets to curate.
2. **需求与场景** — the operational record: requirement list, detail timeline, linked evidence and next action.
3. **AI 平台** — contextual collaboration: private conversation library, active execution, source-to-draft and source-to-solution actions.
4. **需求方案库** — curated private/team solution assets with provenance and lifecycle state.
5. **Skill 资产** — package lifecycle workbench: draft, validation, publication, installation and enabled release state.
6. **知识库** — versioned knowledge, source and attachment workbench.
7. **账号管理** — administrator-only people, controlled fields and runtime operations.

No page may call itself a “platform” only because it contains AI. The UI labels will describe the member’s job first and mention OpenCode only where its runtime state or safety boundary matters.

## Visual System

### Typography

- Bundle an open-licensed Chinese-capable sans family locally for product text and use it before platform fallbacks; no public font CDN is allowed.
- Use one proportional family with 12/13/14/16/20/28/40px semantic steps. Normal operational text is 14px with at least 1.55 line-height; 12px is reserved for metadata, never for primary actions or body copy.
- Use tabular figures for metrics, timestamps and execution counts. Avoid the current mix of Georgia display text and generic system UI text.

### Color and elevation

| Semantic token | Intended role | Initial value |
| --- | --- | --- |
| `--wb-ink` | navigation and high-emphasis surface | `#101C2B` |
| `--wb-canvas` | application background | `#EEF2F6` |
| `--wb-surface` | cards and working panels | `#FFFFFF` |
| `--wb-line` | structural separation | `#D6DEE8` |
| `--wb-text` / `--wb-muted` | primary / secondary copy | `#142237` / `#5F6E82` |
| `--wb-signal` | selected and active system state | `#167F86` |
| `--wb-attention` | clarification and pending action | `#B87320` |
| `--wb-danger` | destructive/error state | `#B74444` |

Surfaces use a one-pixel border and restrained shadow only when they float above a workspace. Status always has text and shape in addition to color.

### Interaction

- Buttons have one clear primary action per working region; secondary actions use quiet borders or text treatment.
- Keyboard focus is a visible two-pixel signal ring. Disabled controls retain readable labels and explain their prerequisite adjacent to the control.
- Motion is limited to short (120–180ms) state transitions, list entry and progress indication; it never delays typing, navigation, or a running Job update.
- Empty states lead to a useful first action and explain the privacy or lifecycle boundary that caused the state.

## Desktop Shell

The shell becomes a stable three-zone structure:

- **Navigation rail:** 248px dark rail; brand, grouped work destinations, selected-route marker, and low-noise account controls. It remains visible at 1024px.
- **Context header:** 72px; route name, one-line business context, lightweight private/scope indicator, and account menu. It contains no marketing copy.
- **Workspace:** a fluid 12-column content grid with a 1440px readable maximum. Dense working pages may use a 280px left record rail, a flexible main detail pane and a 280px action/context pane. At 1024px, the action pane moves below the main pane; the navigation rail does not collapse into a mobile menu.

## Page Designs

### Workbench home

The home page becomes a personal operating brief rather than a hero banner. Its top row presents date/context, one dominant next action and compact runtime health. Below it, requirements, clarification queue, active conversations and assets to curate form an asymmetric priority grid. Counts are secondary to the title and next action; zero states must not dominate the screen.

### Requirements and scenarios

Preserve the established list/detail/action topology, but tighten it into an operational canvas. The left rail carries filters and record signals; the center pane carries title, owner, BU, controlled fields, timeline and linked evidence; the right pane holds exactly one next action sequence. Communication capture appears in context with the timeline, not as an isolated form card.

### AI collaboration

The route is a conversation workspace, not an undifferentiated chat screen. The conversation rail displays ownership, lifecycle and search. The main pane has a compact execution strip that differentiates connected, queued, running, interrupted and recovered states. The composer and messages retain their existing secure event/replay semantics; source-to-requirement and source-to-solution actions appear as contextual outcomes, not decorative AI prompts.

### Solutions, knowledge and Skills

All three assets use a shared asset-workbench pattern: filtered private/team rail, selected asset detail, lifecycle state, provenance/version panel, and one primary permissible action. Skills additionally use a code-oriented editor surface with a compact validation timeline; it must communicate “private draft”, “validated”, “published”, “installed” and “enabled” as distinct states.

### Administration

Administration uses the same shell and tokens but a denser governance layout. Runtime and account control surfaces show only permitted operational metadata. Private member titles, message bodies, requirements and asset bodies remain absent.

## Component and Styling Architecture

P2E replaces the monolithic global CSS approach without changing business logic:

```text
apps/web/src/
  design/tokens.css                 semantic tokens, typography and focus rules
  design/foundation.css             reset, layout primitives, buttons, fields, status badges
  shell/WorkbenchShell.jsx          semantic navigation/header structure
  shell/workbench-shell.css         rail, header and desktop workspace grid
  features/<feature>/<feature>.css  feature-owned page styles
  styles.css                        temporary import manifest only
```

Shared primitives are deliberately small: `PageHeader`, `StatusBadge`, `EmptyState`, `ActionPanel`, `Metric`, and `AssetLifecycle`. They accept semantic props, not color names or route-specific data. Feature components continue to own API calls and lifecycle behavior. Any extraction that changes route behavior must be covered by existing feature contracts plus focused component tests.

## Compatibility and Security Constraints

- Do not alter API paths, request bodies, WebSocket event schema, authentication cookies, CSRF handling, ownership checks, audit payloads, or MySQL migrations.
- Do not render private titles or bodies in new dashboard summaries merely to make the UI look richer.
- Do not add external image, icon, font, analytics or model dependencies. Icons must be inline SVG or locally bundled assets with accessible labels.
- Preserve no-key Demo behavior and make all AI/runtime states explicitly labelled as simulated when in Demo mode.

## Acceptance Evidence

P2E is complete only when all of the following are recorded:

1. Browser validation at 1440px for every work destination and at 1024px for home, requirements, AI collaboration, Skills and administration; no horizontal page overflow, clipped primary control or overlapping panel.
2. Keyboard traversal shows a visible focus indicator, logical route-to-content order and operable primary controls.
3. Realistic Demo data demonstrates empty, populated, loading, error, private, team-visible and lifecycle states without leaking member-private content.
4. Existing React contract tests, API tests, `npm run build`, `npm run check`, `npm run security:scan` and `git diff --check` pass.
5. Screenshots and a short UX acceptance report distinguish local Demo evidence from company production verification.

## Delivery Sequence

1. Establish tokens, foundation styles and the desktop shell, then browser-test the application shell at 1440px and 1024px.
2. Rebuild home and requirements as the reference interaction language.
3. Rebuild AI collaboration, solutions and knowledge using the reference components.
4. Rebuild Skill and administration workbenches, including lifecycle and governance states.
5. Run visual regression/browser acceptance, then the full application quality gate; update README and P2E roadmap status with only verified evidence.

## Non-goals

- No mobile/tablet redesign, new product routes, model-provider integration, data migration, or permission policy change.
- No claim that local Demo, Mac browser checks, or CI proves company Linux or production readiness.
- No wholesale framework replacement or design-system dependency adoption.
