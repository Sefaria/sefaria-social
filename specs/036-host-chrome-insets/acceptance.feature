Feature: The call window keeps clear of the reader's header and side panel

  @AC-001
  Scenario: AC-001 the pinned contract is 1.2 with optional chrome insets
    Given the pinned host contract is updated from a reader commit
    When the factory doctor runs
    Then the contract is 1.2 with an optional ui.chrome member, its source commit and hash are recorded, and doctor passes

  @AC-002
  Scenario: AC-002 the window moves out of the side panel's way
    Given a host with chrome insets top 60 and inline end 0, and the call window at the top right
    When the reader's side panel opens and the inline-end inset becomes 420
    Then the window moves so that it is fully inside the viewport minus 420px at the inline end

  @AC-003
  Scenario: AC-003 an older reader without insets
    Given a SurfaceHost 1.1 host
    When the call window opens
    Then it is placed with a 64px top inset and no other insets, and nothing errors

  @AC-004
  Scenario: AC-004 a bad inset value
    Given a host whose ui.chrome.get returns a negative top, and then throws
    When the call window opens and the insets change
    Then the fallback insets are used and av.error "chrome_invalid" is reported once

  @AC-005
  Scenario: AC-005 the fake host offers insets
    Given the fake host
    When a test sets its chrome insets, and builds a 1.1 host
    Then the surface sees the new insets, and the 1.1 host has no ui.chrome
