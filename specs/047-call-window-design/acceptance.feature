Feature: The call window looks like a call

  @AC-001
  Scenario: AC-001 tiles
    Given a call with A (camera on) and B (camera off, muted)
    Then A's tile shows A's video and B's tile shows B's initials, B's name and a muted mark

  @AC-002
  Scenario: AC-002 the control bar
    Then Microphone, Camera and Share screen are icon buttons with their names and pressed states, and Leave call is red

  @AC-003
  Scenario: AC-003 the pre-join step
    Then a preview area says "Your camera is off" until the camera is on, and Join is the primary button
