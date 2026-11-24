Feature: Join a room's call, choose devices, talk and leave, while the call survives reading

  @AC-001
  Scenario: AC-001 the call state machine follows its table
    Given every pair of call state and event
    When the event is applied
    Then allowed transitions reach the state in the table and forbidden ones leave the state unchanged

  @AC-002
  Scenario: AC-002 the Join call button appears only when calls are available
    Given Dana is in room R's lobby and then in room R's reader context
    When room R says calls are available
    Then the lobby and the follow bar show "Join call"
    And when room R says calls are not available neither shows it

  @AC-003
  Scenario: AC-003 nothing of the call loads before Join call
    Given Dana opens room R's lobby and its reader context
    When she has not clicked "Join call"
    Then no LiveKit code was requested, no LiveKit connection exists and no device access was asked

  @AC-004
  Scenario: AC-004 the pre-join step starts with everything off
    Given Dana is in room R
    When she clicks "Join call"
    Then the pre-join step shows microphone and camera off and device choosers
    And turning the camera on shows her preview
    And clicking "Join" connects with the camera on and the microphone off

  @AC-005
  Scenario: AC-005 device access denied
    Given the browser denies camera and microphone
    When Dana opens the pre-join step
    Then she is told how to allow access, can still join to listen, and is still in room R

  @AC-006
  Scenario: AC-006 talking in the call
    Given Dana and Avi are in room R's call
    When Avi turns on his camera and microphone and Dana shares her screen
    Then Dana hears Avi and sees his video, and Avi sees Dana's screen

  @AC-007
  Scenario: AC-007 leaving the call keeps the room, leaving the room ends the call
    Given Dana is in room R's call with her camera on
    When she clicks "Leave call"
    Then she is disconnected, her camera is released and she is still in room R
    And when she rejoins and then leaves room R, the call ends first

  @AC-008
  Scenario: AC-008 one call at a time
    Given Dana is in room R's call and is a member of room S
    When she clicks "Join call" in room S and confirms
    Then she leaves room R's call before joining room S's

  @AC-009
  Scenario: AC-009 the call survives reading
    Given Dana is in room R's call
    When she goes to another ref, minimises, opens the feed and enlarges again
    Then the call stays connected with no new join

  @AC-010
  Scenario: AC-010 a reload never rejoins by itself
    Given Dana was in room R's call
    When she reloads the page at room R's reader context
    Then the room reconnects and "Join call" is offered, and no call or device request starts

  @AC-011
  Scenario: AC-011 reconnecting, then giving up
    Given Dana is in room R's call
    When the LiveKit connection drops
    Then the call shows it is reconnecting and reconnects with a fresh token
    And when it cannot reconnect within 30 seconds the call ends with a "Rejoin" button

  @AC-012
  Scenario: AC-012 reports carry no personal data
    Given the host records reports
    When Dana joins, reconnects, hits an error and leaves
    Then av.join, av.reconnect, av.error and av.leave are reported, with no names, identities or device labels
