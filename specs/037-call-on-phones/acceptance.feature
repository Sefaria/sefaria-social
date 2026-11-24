Feature: On a phone the call docks as a strip at the top instead of floating

  @AC-001
  Scenario: AC-001 a docked strip on a narrow screen
    Given Dana is reading on a 390px wide phone in room R
    When she joins the call
    Then the call is a full-width strip under the top inset with no drag or resize handle

  @AC-002
  Scenario: AC-002 collapsed and expanded
    Given Dana is in a call on a phone
    When she looks at the strip, taps Expand and then Collapse
    Then it is 48px high with avatars, speaking ring, microphone, Leave and Expand
    And expanded it shows the active speaker at 16:9 across the width, and Collapse returns it to 48px

  @AC-003
  Scenario: AC-003 rotating or resizing keeps the call
    Given Dana is in a call in a 390px wide viewport
    When the viewport becomes 900px wide and then 390px again
    Then the strip becomes the floating window and back, and the call never disconnects

  @AC-004
  Scenario: AC-004 coming back to a paused call
    Given Dana is in a call on a phone
    When the tab is hidden, the browser suspends its audio, and the tab is shown again
    Then she is told the call was paused and one button resumes the audio

  @AC-005
  Scenario: AC-005 no video while collapsed
    Given Dana is in a call on a phone with the strip collapsed
    When others have their cameras on
    Then Dana receives no video tracks
