# Plan: 037 on a phone the call docks as a strip at the top instead of floating

Builds on spec 035's window and spec 036's insets. One frame decision, same content: `CallPanel` already renders the pre-join
step, tiles and controls; on a narrow viewport they go in a strip instead of the floating window, so switching frames never
touches the call (AC-003).

## T-001 the docked strip (AC-001, AC-002, AC-003, AC-005)

- `features/av/CallStrip.tsx` (+ `strip.module.css`): fixed, full width, directly under the top inset (spec 036's `top`). No
  handle, no resize. Collapsed (default, 48 px): the pill's content (avatars, speaking ring, microphone) plus Leave and Expand.
  Expanded: the active speaker at 16:9 across the width (one tile: tile limit `strip` = 1), the controls, and Collapse.
- `features/av/CallFrame.tsx` chooses: viewport narrower than 600 px → `CallStrip`, else `CallWindow`; `CallPanel` renders through
  it. The choice follows `resize` (rotation), and both frames wrap the same panel element, so the call controller and the media
  connection are untouched by a switch.
- While collapsed no tiles render, so `setVisible([])` (spec 035's mechanism): no video is received (AC-005).
- Test: `surface/call-strip.test.tsx` (jsdom, `window.innerWidth` set and a `resize` event).

## T-002 coming back to a paused call (AC-004)

- `features/av/use-paused.ts`: on `visibilitychange` to visible, if the call's media reports `audioBlocked()` (the browser
  suspended audio in the background), the panel shows "The call was paused" with one button, Resume, which calls `startAudio()`
  inside the tap. A dropped connection already shows Reconnecting and then Rejoin (spec 034); the notice does not repeat that.
- Strings in English and Hebrew.
- Test: in `surface/call-strip.test.tsx`, with the fake engine's `blockAudio(true)` and a `visibilitychange` event.

## e2e

`e2e/calls.spec.ts` on the phone project expands the strip before reading tiles (the strip starts collapsed, which receives no
video), so spec 040's journey keeps checking frames on phones.

## Risks

- jsdom has no layout: the strip's position and height are read from its inline style and class; the e2e phone run is the
  real-browser check of the frames arriving through the expanded strip.
