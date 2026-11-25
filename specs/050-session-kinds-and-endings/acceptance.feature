Feature: Session kinds and endings, one Record toggle, and Close, Finish and Leave

  @AC-001
  Scenario: AC-001 Record on, off, on
    Given the owner leads a session in room R
    When they press Record, wait 3 seconds, press it again, wait 5 seconds, press it again, wait 2 seconds and finish
    Then one recording is saved
    And its media and its reader timeline are about 5 seconds long

  @AC-002
  Scenario: AC-002 the owner closes the room
    Given the owner and a follower are in room R and the owner is recording
    When the owner presses Close room and confirms
    Then the recording is finished
    And both are out of R's context, and the follower is told "The room was closed."

  @AC-003
  Scenario: AC-003 a follower leaves
    Given the owner and two followers are in room R
    When one follower presses Leave
    Then only that follower is out of R, and the session goes on for the others

  @AC-004
  Scenario: AC-004 a closed room starts again
    Given room R was closed
    When a member enters R before the owner
    Then they are told the room was closed
    When the owner enters R
    Then a new session starts in R

  @AC-005
  Scenario: AC-005 the owner is gone for 2 minutes
    Given the owner leads a session with a follower
    When the owner's connection is gone for 2 minutes
    Then the session ends for the follower as if the owner closed it
    But if the owner comes back after 1 minute the session goes on

  @AC-006
  Scenario: AC-006 choosing the kind at Start
    When a person starts a room and chooses Broadcast
    Then Record this session is on, and the session starts broadcasting and recording
    When a person chooses Just me
    Then Record this session is on, and the session starts recording

  @AC-007
  Scenario: AC-007 the words for ending
    Then the owner of a just-me session sees Finish and save, of a broadcast End broadcast, of a room Close room
    And everyone else sees Leave
