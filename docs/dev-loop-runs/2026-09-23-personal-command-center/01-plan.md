# Personal Command Center Plan

## Architecture Summary

Keep the existing owner-scoped four-endpoint load. Expand the pure home view model so presentation code receives sorted requirements, clarification work, active conversations, asset counts and recent milestones. Rebuild only the home composition and the small shell handoff needed to personalize it.

## Task Order

1. Add failing UI/view-model tests for five signals, owner-visible rows, sorting, bounded lists and empty/error behavior.
2. Implement the personal command-center view model and semantic React regions.
3. Replace the uneven spanning-card CSS with a stable 12-column layout and a deliberate 1024px layout.
4. Run browser acceptance at 1440x1000 and 1024x900; fix overflow, focus and hierarchy issues.
5. Update README and P2E records, run the full gate, write acceptance artifacts, commit in Chinese and push `main`.

## Files

- Modify `apps/web/src/features/home/HomePage.jsx`: pure view model and semantic dashboard.
- Modify `apps/web/src/features/home/home.css`: fixed desktop composition and state styling.
- Modify `apps/web/src/shell/WorkbenchShell.jsx`: pass authenticated user to the personal home.
- Modify `test/ui/react-features.test.js`: user-visible contracts and privacy boundary.
- Modify `README.md`: product-facing experience and verified stage status.
- Modify P2E design/plan/progress documentation and this run's evidence files.

## Test Strategy

- RED/GREEN: `node --test --test-name-pattern="home workbench|home view model" test/ui/react-features.test.js`
- Focused: `node --test test/ui/react-features.test.js`
- Full: `npm test`
- Static/build: `npm run build`, `npm run check`, `npm run security:scan`, `git diff --check`
- Browser: authenticated Demo at 1440x1000 and 1024x900, screenshots plus DOM overflow/focus checks.

## Acceptance Mapping

- AC1-2: focused SSR/view-model tests.
- AC3-4: browser screenshots and DOM/focus inspection.
- AC5: full quality gate outputs.
- AC6: README diff plus explicit local/production wording review.

## Risks and Rulings

- Existing APIs do not provide due dates or progress percentages. The UI will not invent them; it will show status and last-update recency.
- Personal titles are safe only because the endpoints are owner-scoped. The change is limited to the authenticated personal home and does not affect admin/team aggregate surfaces.
- The supplied image is a structural reference, not a pixel asset or a source of real data.
