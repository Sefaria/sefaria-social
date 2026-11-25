Feature: One press to get in, starting a room lands you in it with the call, and an invitee's Join does everything

  @AC-001
  Scenario: AC-001 Start lands the starter in the room and its call
    Given a signed-in person on Social's home
    When they name a room "Daf Yomi" and press Start
    Then the reader is in the new room's context
    And the room's call is connecting with their last microphone and camera choice
    And no lobby, Enter or pre-join step came in between

  @AC-002
  Scenario: AC-002 an invitee's one Join
    Given a signed-in invitee on a room's link
    When they press Join
    Then they are a member, in the room's context at the leader's place, in the call with microphone and camera off

  @AC-003
  Scenario: AC-003 Join while signed out
    Given a signed-out invitee on a room's link
    When they press Join and sign in
    Then they end as in AC-002 without pressing Join again

  @AC-004
  Scenario: AC-004 Enter the room also joins the call
    Given a member in a room's lobby
    When they press Enter the room
    Then they are in the room's context and in its call

  @AC-005
  Scenario: AC-005 calls off
    Given a server that does not offer calls
    When a person starts a room, an invitee joins, or a member enters
    Then they are in the room's context and no call starts

  @AC-006
  Scenario: AC-006 the owner's choice is remembered
    Given the owner turned their camera on in a call
    When they start another room
    Then its call starts with the camera on
    And an invitee to that room still starts with both off
