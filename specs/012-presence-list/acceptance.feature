Feature: Who is in the room, live, in the lobby and the mini view

  @AC-001
  Scenario: The lobby lists who is here
    Given a member on the lobby of a room where "Leader" holds the spotlight and "Follower" follows "Leader"
    Then the list shows "Leader" as leading and "Follower" as following "Leader"
    And the connection offered a bearer token in its subprotocols, not in its URL

  @AC-002
  Scenario: The viewer is marked and cannot follow themselves
    Given the viewer is in the list
    Then their entry says "you" and has no follow button
    And every name has dir="auto"

  @AC-003
  Scenario: Reconnecting keeps the list; leaving closes the socket
    Given the list shows two people
    When the connection drops
    Then the list still shows two people and says "Reconnecting"
    When the viewer leaves the lobby with no context or live session
    Then the connection is closed
