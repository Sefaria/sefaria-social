Feature: Following is sticky, the room's owner is its one leader, and you follow a person by clicking them

  @AC-001
  Scenario: AC-001 clicks that do not move the reader keep a follower following
    Given follower F follows leader L in room R
    When F clicks the room window, the call window and Join call
    Then F is still following L

  @AC-002
  Scenario: AC-002 a small move keeps following
    Given F and L are on Genesis 1:3
    When F scrolls to Genesis 1:6 and stops
    Then F is still following L
    And when L moves to Genesis 1:10, F is taken there

  @AC-003
  Scenario: AC-003 a clear move breaks away
    Given F and L are on Genesis 1:3
    When F scrolls to Genesis 1:8 and stops, or goes to Genesis 2 or to Exodus 1
    Then F is on their own, with Follow again

  @AC-004
  Scenario: AC-004 the server issues a room ticket with the caller's role
    When the owner of R asks for a ticket for R
    Then the ticket names the owner with role owner, valid for 10 minutes
    And a member gets role member, and someone who is not a member gets 404

  @AC-005
  Scenario: AC-005 only the owner's ticket makes a leader
    When a socket joins R with an owner ticket for R and its user
    Then it joins as a host who may lead
    And with a member ticket, no ticket, a tampered or expired ticket, or a ticket for another room or user it joins as a member
    And a member's request for the spotlight is refused

  @AC-006
  Scenario: AC-006 no Lead button
    Given a member is in R's context
    Then the room window has no Lead button and no mode control
    And the owner holds the spotlight from the moment they join

  @AC-007
  Scenario: AC-007 follow a person by clicking them
    When F clicks M in who is here, or M's call tile
    Then F follows M
    And clicking M again, or the leader, returns F to following the leader
    And when the leader clicks M, the room window offers Lead again, which returns the leader to leading

  @AC-008
  Scenario: AC-008 the leader takes followers along
    Given F follows L
    When L follows M and M moves to Exodus 3
    Then F is on Exodus 3
    And when A and B follow each other, a move by A reaches B once and does not echo back and forth
