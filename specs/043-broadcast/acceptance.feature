Feature: A room's owner broadcasts live to view-only viewers, who follow the reader and watch the host but send nothing back

  @AC-001
  Scenario: AC-001 only the owner starts and ends a broadcast
    Given room R owned by O with member M
    When O, M and outsider X start a broadcast for R, and O starts a second
    Then O gets 201 with an id and link, M gets 403, X gets 404 and the second gets 409
    And O can end it

  @AC-002
  Scenario: AC-002 tickets name the role
    Given O's live broadcast B
    When O and X ask for B's ticket
    Then O's ticket says host and X's says viewer, both for B and their own user, expiring in 10 minutes
    And after B ends, a ticket request gets 404

  @AC-003
  Scenario: AC-003 the relay requires a ticket for a broadcast room
    When a socket with a valid identity connects to b_<B> without a ticket, with one for another broadcast, another user, or expired
    Then each is refused with 401
    And with a valid ticket it is accepted

  @AC-004
  Scenario: AC-004 a viewer can only receive
    Given host O and viewers V and W in b_<B>
    When V sends a state change, a presence status, a spotlight to itself, a mode change and an end
    Then none reaches the room, O stays the spotlight, and V receives O's state
    And V's participants list names O only, and V's join says isHost false and canLead false

  @AC-005
  Scenario: AC-005 call tokens for host and viewer
    When O and V ask for B's call token
    Then O's grant can publish and V's cannot publish or publish data, can subscribe and is hidden

  @AC-006
  Scenario: AC-006 the owner broadcasts from the lobby
    When O presses Broadcast in R's lobby
    Then the link is shown with Copy and O's reader is published to b_<B>
    When O presses End broadcast
    Then the broadcast is ended

  @AC-007
  Scenario: AC-007 a viewer watches
    Given O is broadcasting from Genesis 1
    When signed-in V opens the link and presses Watch
    Then V's reader shows Genesis 1 with ctx social.watch.<B>, follows O to Genesis 2, and the window shows O with no microphone or camera controls

  @AC-008
  Scenario: AC-008 the end of a broadcast
    When O ends the broadcast
    Then V sees "The broadcast has ended" and V's reader stops following
