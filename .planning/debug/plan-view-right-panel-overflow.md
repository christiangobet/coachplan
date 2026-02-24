---
status: investigating
trigger: "plan-view-right-panel-overflow — right panel overlaps middle panel when content is long"
created: 2026-02-24T00:00:00Z
updated: 2026-02-24T00:00:00Z
---

## Current Focus

hypothesis: Right panel lacks a max-height or height constraint, causing it to grow beyond its column boundary and overlap the middle panel
test: Read plans.css and page.tsx to find layout classes and check overflow/height rules
expecting: Missing overflow-y, missing min-height:0, or unconstrained position:sticky panel
next_action: Read src/app/plans/plans.css and src/app/plans/[id]/page.tsx

## Symptoms

expected: Right panel stays in its column, no overlap with the middle panel regardless of content length
actual: When right panel content is long (long plan guide text, long AI chat history), the panel overflows into the middle panel column
errors: None — purely visual/layout
reproduction: Open a plan with a long guide or after a few AI chat turns; right panel bleeds over the middle grid
started: Unknown — possibly always present

## Eliminated

(none yet)

## Evidence

- timestamp: 2026-02-24T00:00:00Z
  checked: plans.css — .pcal-layout, .pcal-chat-panel, .pcal-guide-panel, .pcal-ai-trainer-chat
  found: |
    .pcal-layout is a 3-col CSS grid with align-items: start (good).
    .pcal-chat-panel has position: sticky; top: 88px; align-self: start — but NO max-height and NO overflow-y on the panel wrapper itself.
    .pcal-guide-panel has max-height: calc(100vh - 150px); overflow-y: auto — this one IS constrained.
    .pcal-ai-trainer-chat has max-height: calc(100vh - 110px); overflow: auto — this is only the section element that wraps the AI trainer content.
    BUT the section .pcal-ai-trainer-chat is INSIDE .pcal-chat-panel which has no height constraint.
    The .pcal-ai-thread (chat bubbles) has max-height: 320px; overflow: auto — that inner scroll area is constrained.
    The AI proposal section (.pcal-ai-trainer-proposal) and change list have NO max-height — they grow unbounded.
  implication: |
    When the AI proposal is long (many changes, invariant report, risk flags), the proposal section
    grows as tall as its content with no overflow clipping. The .pcal-chat-panel wrapper has
    position: sticky + align-self: start, which means it extends downward from the sticky top
    past the viewport boundary, and since the parent grid only uses align-items: start (not
    stretch), the panel visually overflows below the grid row height.

- timestamp: 2026-02-24T00:00:00Z
  checked: page.tsx — .pcal-chat-panel aside, section.pcal-ai-trainer-chat
  found: |
    The aside has className "pcal-chat-panel".
    Inside it: .pcal-sidebar-tabs, then conditionally .pcal-guide-panel, then section.pcal-ai-trainer.pcal-ai-trainer-chat.
    The section has style={sidebarTab === 'guide' ? { display: 'none' } : undefined}.
    The section carries both classes: pcal-ai-trainer (which has padding/gap/display grid) AND pcal-ai-trainer-chat (which has max-height: calc(100vh - 110px); overflow: auto).
    So the SECTION itself is overflow: auto with max-height — but the overflow is on the section, not the aside wrapper.
    A grid child (.pcal-ai-trainer) with display:grid and gap grows as large as all its children combined.
    The max-height on .pcal-ai-trainer-chat should clip the section, BUT the issue is:
    The aside (.pcal-chat-panel) is position: sticky with no height limit.
    align-self: start means it only takes the height of its content, not the row height.
    So if the section content overflows its own max-height it's clipped inside, but the aside container itself has no constraint and can be taller than the viewport/grid row.
  implication: |
    The core fix needed: .pcal-chat-panel needs a max-height so the entire aside cannot grow
    taller than the viewport. Without it, even though individual inner sections have max-heights,
    the aside wrapper itself can expand freely.

## Resolution

root_cause: |
  .pcal-chat-panel (the right aside) has position: sticky + align-self: start but NO max-height
  and NO overflow-y constraint. The aside wrapper grows to the full height of its content.
  When the AI trainer section has a long proposal (many changes, invariant report, risk flags),
  the aside expands past the viewport bottom and visually overlaps the middle column grid.
  The inner sections (.pcal-guide-panel, .pcal-ai-trainer-chat) have their own max-height rules
  but those only control scrolling inside those sections — they do not constrain the aside wrapper.

fix: |
  Add to .pcal-chat-panel:
    max-height: calc(100vh - var(--d-sticky-top));
    overflow-y: auto;
  This caps the entire right panel at viewport height minus the sticky offset (88px),
  matching the already-used --d-sticky-top token. Content beyond that scrolls within the panel.

verification: pending
files_changed:
  - src/app/plans/plans.css
