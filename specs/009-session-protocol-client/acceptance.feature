Feature: Room protocol and client in packages/session, kept in step with the reader's copy

  @AC-001
  Scenario: The room enforces the reader's limits and stamps envelopes itself
    Given a room from packages/session with one joined connection
    When the connection sends a 16 385-byte frame, 21 changes in one second and an envelope with its own "from"
    Then the oversized frame and the 21st change are not relayed
    And the relayed envelope carries the room's "from", not the client's

  @AC-001
  Scenario: A full room refuses the next participant
    Given a room with 200 participants
    When another connection joins
    Then the room answers "refused" with reason "room full"

  @AC-002
  Scenario: A client follows the spotlight through the state API
    Given two clients in one room and the first holds the spotlight
    When the first moves to "/Genesis.2"
    Then the second applies "/Genesis.2" with origin "follow"

  @AC-002
  Scenario: A client publishes nothing while canPublish says no
    Given a client holding the spotlight whose canPublish returns false
    When its reader moves
    Then nothing is sent on the state channel

  @AC-003
  Scenario: Each connection asks for fresh subprotocols
    Given a WebSocket transport whose protocols callback returns a new token each time
    When the socket opens, drops and reopens
    Then the two sockets were opened with different tokens and the URL holds no token

  @AC-004
  Scenario: The reader's recorded protocol results still hold
    Given the fixture file recorded from the reader's room code
    When every case is replayed through parseEnvelope and parseRoomEnvelope
    Then every result equals the recorded one and the limits are 16384, 200 and 20

  @AC-005
  Scenario: A drift check against a reader checkout names the differing case
    Given a reader checkout whose room refuses a case the fixture accepts
    When the fixture check runs against it
    Then it fails and names that case
