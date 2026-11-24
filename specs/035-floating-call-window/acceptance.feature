Feature: The call floats over the reader in a window the learner can move and resize

  @AC-001
  Scenario: AC-001 the window never moves the text
    Given Dana is reading Genesis 1 in room R and has scrolled to verse 5
    When she joins the call, moves the window, resizes it and leaves
    Then the text column's box and the scroll position are the same as before

  @AC-002
  Scenario: AC-002 the default place is the top inline-end corner
    Given no saved window position
    When Dana joins a call in the English interface, and later in the Hebrew interface
    Then the window is 16px inside the top right corner of the insets, and in Hebrew 16px inside the top left

  @AC-003
  Scenario: AC-003 the four sizes
    Given a call with 11 participants
    When Dana picks pill, small, medium and large in turn
    Then she sees avatars and a microphone toggle, the speaker with a strip, a grid of 4 with "+7", and a grid of 9 with "+2"
    And the large window is at most 60% of the viewport in each dimension

  @AC-004
  Scenario: AC-004 dragging by the handle snaps to a corner
    Given the call window at the top right
    When Dana drags the handle to just left of the viewport's centre near the bottom and releases
    Then the window snaps to the bottom left corner 16px inside the insets
    And dragging that starts on a video tile does not move the window

  @AC-005
  Scenario: AC-005 resizing from the corner
    Given the call window at the small size
    When Dana drags the resize handle far beyond the large size
    Then the window stops at the large size and the tile area stays 16:10

  @AC-006
  Scenario: AC-006 the window stays on screen
    Given the call window at the bottom right at the large size
    When the viewport narrows to 700px wide
    Then the whole window is still inside the insets

  @AC-007
  Scenario: AC-007 the place is remembered, and bad storage is harmless
    Given Dana left a call with the window at the bottom left, medium size
    When she joins another call
    Then the window opens at the bottom left, medium size
    And when storage throws or holds garbage the window opens at the default place without an error

  @AC-008
  Scenario: AC-008 moving with the keyboard
    Given the window's handle has focus
    When Dana presses ArrowLeft, then Shift+ArrowDown, then picks "Move to bottom left" from the handle's menu
    Then the window moves 16px left, then 64px down, then to the bottom left corner, and each move is announced politely

  @AC-009
  Scenario: AC-009 the window is not a modal
    Given the call window is open
    When Dana presses Tab past its last control and then presses Escape inside it
    Then focus moves on to the reader and Escape collapses the window to the pill
    And every control is at least 24 by 24px with a visible focus ring and an accessible name

  @AC-010
  Scenario: AC-010 reduced motion
    Given Dana prefers reduced motion
    When the window snaps and changes size
    Then no transition runs

  @AC-011
  Scenario: AC-011 hidden tiles keep their audio
    Given a call with 11 participants and the window at the pill size
    When the participants talk
    Then Dana receives no video tracks and hears every participant
