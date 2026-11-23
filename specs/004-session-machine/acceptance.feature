Feature: Enlarge and minimise session state machine

  @AC-001
  Scenario: An allowed move
    Given the session is "expanded" in the room "room-00001"
    When "detach" arrives
    Then the session is "detached" in the room "room-00001"

  @AC-002
  Scenario: A forbidden move
    Given the session is "idle"
    When "minimise" arrives
    Then the move is refused and the session is still "idle"

  @AC-003
  Scenario: Entering waits for the right context
    Given the session is "entering" the room "room-00001"
    When the reader reports the context of the room "room-00002"
    Then the move is refused and the session is still "entering"
