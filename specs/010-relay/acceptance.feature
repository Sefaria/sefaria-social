Feature: Room relay on Cloudflare with a token check, a status read and a drop for deleted users

  @AC-001
  Scenario: Two sockets in one room see each other
    Given the relay running in workerd with an allowed Origin
    When two users with valid tokens open /r/room-0000001 and join
    Then each receives a participants list holding both

  @AC-001
  Scenario: Bad paths, plain requests and foreign Origins are refused
    When a request goes to /r/x, a plain GET goes to /r/room-0000001, and an upgrade comes from https://evil.example
    Then they get 404, 426 and 403

  @AC-002
  Scenario: No token or a bad token is refused before the room
    When an upgrade carries no token, a token signed by another key, an expired token or a token in the URL only
    Then each gets 401 and the room has no participant

  @AC-002
  Scenario: An accepted socket names only the protocol
    When an upgrade offers "sefaria-social.v1, bearer.<valid token>"
    Then the response's Sec-WebSocket-Protocol is "sefaria-social.v1"

  @AC-003
  Scenario: The token decides who joins
    Given user 4242 named "Test Learner" is connected
    When the socket joins claiming id "someone-else"
    Then the room lists participant "4242" named "Test Learner"

  @AC-004
  Scenario: The status read for cards
    Given the spotlight holder's stream has the summary ref "Genesis 1" and one other participant is joined
    When the server reads /internal/status/room-0000001 with the secret
    Then it gets ref "Genesis 1", title "Genesis 1" and 2 participants
    And without the secret it gets 401

  @AC-005
  Scenario: A deleted user is dropped and kept out
    Given user 4242 is connected to room-0000001
    When the server posts drop-user for 4242 with the secret
    Then 4242's socket closes and a new upgrade by 4242 to any room gets 401
    And the same call without the secret gets 401 and drops nobody
