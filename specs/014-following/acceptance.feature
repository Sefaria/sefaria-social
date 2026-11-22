Feature: Following someone in a room through the reader state API, proven with two learners

  @AC-001
  Scenario: Following the leader, or someone picked
    Given a viewer in the room's context while "Leader" holds the spotlight
    When "Leader" moves to "/Genesis.4"
    Then the viewer's reader is told applySnapshot "/Genesis.4" with origin "follow"
    When the viewer picks "Other" in the presence list and "Other" moves to "/Exodus.1"
    Then the viewer's reader goes to "/Exodus.1"

  @AC-002
  Scenario: Breaking away and following again
    Given a viewer following "Leader"
    When the viewer scrolls the reader themselves and "Leader" moves on
    Then nothing is applied and "Follow again" is offered
    When they press "Follow again"
    Then "Leader"'s current place is applied at once

  @AC-003
  Scenario: Taking the lead
    Given a viewer in the room's context who does not lead
    When they press Lead
    Then the room says they hold the spotlight and their moves reach their followers

  @AC-004
  Scenario: Two learners in one room on the harness
    Given two browser contexts joined to one room on the harness, with the local relay and server
    When the leader moves to another chapter
    Then the follower's reader shows that chapter and their settings slice is unchanged
    When the follower refreshes the page
    Then they are reconnected and still follow the leader
    When the follower goes Back
    Then they are out of the room
