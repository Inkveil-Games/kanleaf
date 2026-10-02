# Properties UI refinement and remote integration

The user queued three follow-ups during the prior implementation: merge new remote dev commits and reuse suitable shared components, provide Priority value descriptions, and improve Labels/Date form design. Continue in that order, on dev, preserving all uncommitted work and the hosted source preview. User reviews the live UI before saying “xong”; do not commit local work or push.

## Design

This is a bounded refinement of existing forms. Keep the routed Settings article, restrained tokens and density. Group Name/Type and a shorter description area as one metadata block. Give Property values a clean toolbar and aligned rows, grouping color/icon with the value name rather than leaving a separate tiny visual column. Retain descriptions, default checkboxes/radios and existing management actions.

Use the incoming shared SegmentedControl for None/Fixed/Dynamic. Show a compact fixed-date control or numeric amount beside the existing eight-option offset selector. Keep a short, user-facing hint; put timezone/zero/month-end details in an accessible help tooltip. Reuse InlineAlert for property errors/refresh feedback. No new primitive or dependency.

Priority descriptions are predefined display copy, following State's value description column. No priority vocabulary editing is introduced.

## Constraints

- Preserve all previous default API, task creation, persistence, permissions, draft/error/retry, Labels partial-save and fixed-vocabulary semantics.
- Labels stays first; built-ins above custom properties; no Status column or lock treatment; no removed built-in properties restored.
- Same property form/value renderer for Labels/custom/built-in properties. No card-heavy layout or isolated competing control system.
- Selecting the already-selected date mode must retain its entered date/offset. Native date input and numeric validation remain intact. All eight offsets, None clear and creator-local server semantics remain unchanged.
- Use tokens, light/dark styles and shared keyboard/focus primitives. Test wide, minimum desktop and narrow layouts.
- Merge remote dev without committing local property work. Back up/stash local tracked and untracked changes, fast-forward dev where possible, restore and resolve every conflict preserving both changes. Do not rewrite remote history or modify real data.

## Tasks

1. Complete prior functional review fix, snapshot local work, fast-forward dev to fetched origin/dev, restore local changes, resolve integration conflicts and audit shared UI reuse. Verify typecheck before the visual task.
2. Apply the bounded form/value/date refinement, predefined Priority descriptions and shared feedback reuse. Use a fresh implementation agent with a concrete brief, then task review. Preserve tests and add behavior coverage for changed mode interaction and Priority descriptions; no CSS snapshot tests.
3. Verify relevant frontend tests plus full frontend suite/build after integration, real browser save/reload/creation and keyboard/theme/responsive checks. Inspect screenshots, review the wave's incremental diff, and keep the preview running for user approval.

Backend behavior is unchanged in this wave. Reuse already-passing backend evidence unless a merge or fix changes backend production code.
