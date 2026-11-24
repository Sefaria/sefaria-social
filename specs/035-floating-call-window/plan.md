# Plan: 035 the call floats over the reader in a window the learner can move and resize

Design: `docs/design/audio-video.md` section 6.2. Builds on spec 034's `CallPanel` (the content) and spec 040's e2e lane.
The reader's insets come from spec 036; until it lands, `features/av/insets.ts` returns the fallback (top 64, others 0), and
036 only changes where the numbers come from.

## Approach

**Geometry as pure functions** (`features/av/window-geometry.ts`), all in CSS pixels, with logical corners so the Hebrew
interface mirrors:

- `Placement = { v: 1; corner: "top-start" | "top-end" | "bottom-start" | "bottom-end"; offsetX; offsetY; size; width? }`,
  offsets measured from the corner, inside the insets. Default `{ corner: "top-end", offsetX: 16, offsetY: 16, size: "small" }`.
- `dimensions(size, width, viewport)`: pill 240×48; small 320×(200 + controls); medium 480×(300 + controls); large up to 60 %
  of the viewport in each dimension; a free `width` between small and large keeps the tile area at 16:10.
- `rect(placement, dims, area, dir)`: the absolute box, clamped inside `area` (viewport minus insets).
- `snap(box, area, dir)`: the nearest corner by the box's centre, offsets 16.
- `nudge(placement, dx, dy, …)`: keyboard moves, physical arrows, re-expressed from the same corner, clamped.
- `loadPlacement(storage)` / `savePlacement(storage, p)`: zod-parsed `{ v: 1, … }` under `sefaria-social.call-window`; any
  failure (no storage, it throws, garbage) gives the default.

**The window** (`features/av/CallWindow.tsx`, `window.module.css`): `CallPanel` renders its content inside it.

- `position: fixed` in the persistent mount; moved with `transform` during a drag, `left`/`top` committed on release.
- The title bar is a real `<button>` handle with pointer capture; a drag that starts on a tile or a control never reaches it.
- Resize handle in the corner opposite the anchor; the size buttons jump between presets; pill shows avatars, the speaking
  ring, the microphone toggle and Expand.
- Keyboard: on the handle, arrows move 16 px, Shift+arrows 64 px; a menu (`aria-haspopup`) with the four corners and the four
  sizes; each move announced in a polite live region. Escape inside the window collapses it to the pill. No focus trap.
- `prefers-reduced-motion`: the `transition` on transform and size is off.
- Re-placed on viewport resize, size change and inset change (`ResizeObserver` on the window, `resize` on `window`).
- Visible tiles: pill none; small the active speaker and three in the strip; medium 4; large 9; the rest as "+N".
  `CallMedia.setVisible` gets the visible ids, so hidden participants send no video (AC-011); audio is untouched.

## Tasks and tests

| Task                           | ACs                                    | Test                                                                                                                                                                                      | Why it fails today             |
| ------------------------------ | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| T-001 geometry                 | AC-002, AC-006, AC-007                 | `features/av/window-geometry.test.ts` (unit)                                                                                                                                              | no module (`import.meta.glob`) |
| T-002 the window               | AC-003, AC-008, AC-009, AC-010, AC-011 | `surface/call-window.test.tsx` (jsdom, fake engine)                                                                                                                                       | no window around the panel     |
| T-003 layout in a real browser | AC-001, AC-004, AC-005                 | `e2e/call-window.spec.ts` on the harness, desktop: the text column's box and scroll before and after; drag and release near a corner; drag starting on a tile; resize past the large size | no window                      |

## Risks

- The harness's text column stands in for the reader's; the real-reader lane (L4b) is not running yet.
- jsdom has no layout: everything about boxes is in the unit tests (pure functions) or the e2e lane.
