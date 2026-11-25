Feature: The reader's two mounts share one call and one room connection, so Join call opens the call window

  @AC-001
  Scenario: AC-001 Join call in the lobby opens the call window
    Given the reader mounts the page with host A and the persistent mount with host B
    When the viewer presses Join call in the lobby
    Then the persistent mount shows the pre-join step

  @AC-002
  Scenario: AC-002 one connection per room
    Given the lobby and the room window both show room R
    Then the relay has one connection from the viewer to R

  @AC-003
  Scenario: AC-003 one host for both mounts
    Given a host that was never registered
    Then each controller is kept for that host as before
