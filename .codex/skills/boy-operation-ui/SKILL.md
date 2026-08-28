---
name: boy-operation-ui
description: Design and review UI, UX, interaction flow, and user-facing copy for BOY Operation System. Use when editing BOY web pages, forms, cards, navigation, dialogs, warnings, status messages, responsive mobile layouts, or any text shown to staff.
---

# BOY Operation UI

Create compact, professional screens for staff who need to complete operational work quickly and accurately.

## Information hierarchy

- Show only information needed to decide or act at the current step.
- Put the primary action and current status first. Keep secondary details collapsible or contextual.
- On mobile, stack fields or use small balanced groups. Never squeeze many controls into one row.
- Preserve clear labels, comfortable touch targets, consistent field sizes, and visible error states.

## User-facing copy

- Write short, direct Thai copy in the user's language.
- Do not place briefs, design rationale, implementation details, or explanations of obvious UI behavior on operational screens.
- Avoid permanent prose such as “ส่วนนี้มีไว้เพื่อ...”, “ระบบจะ...เพื่อป้องกัน...”, or descriptions that merely restate the layout.
- Show extra explanation only when it changes the user's next action. Use validation, warning, error, success, locked-state messages, tooltip, or help content at the relevant moment.
- Keep persistent microcopy only when it prevents a likely data-entry mistake.

## Review dialogs

- Summarize only fields the user must verify before confirming.
- Prefer item counts and missing-data warnings over repeating calculations already visible elsewhere.
- Do not block submission for a warning unless the business rule explicitly requires the field.
- Move system consequences to the event where they occur. Explain a lock when the date becomes locked or when the user tries to edit it, not as permanent pre-submit prose.

## Verification

- Test the relevant breakpoint, especially 390 px mobile width.
- Verify no horizontal overflow, clipped labels, mismatched paired-field sizes, or obscured fixed navigation.
- Exercise the interaction, including empty, complete, warning, expanded, and locked states that changed.
