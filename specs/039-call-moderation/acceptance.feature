Feature: A room's owner can mute a participant or remove them from the call

  @AC-001
  Scenario: AC-001 the owner mutes a microphone
    Given Avi owns room R and Dana is in its call with her microphone on
    When Avi mutes Dana's microphone
    Then the answer is 204 and Dana's microphone track is muted

  @AC-002 @AC-003
  Scenario: AC-002 AC-003 the owner removes someone, who cannot rejoin for a while
    Given Avi owns room R and Dana is in its call
    When Avi removes Dana from the call
    Then the answer is 204, Dana is out of the call and still a member of room R
    And Dana's call token requests for room R answer 403 "removed_from_call" for 15 minutes

  @AC-004
  Scenario: AC-004 only the owner may moderate
    Given Dana is a member of room R but not its owner, and Noa is not a member
    When each tries to mute a participant in room R's call
    Then Dana gets 403 and Noa gets 404

  @AC-005
  Scenario: AC-005 an unknown participant
    Given Avi owns room R
    When he mutes "u:999" who is not in the call, and "dana" which is not an identity
    Then both answer 404 and LiveKit is not called

  @AC-006
  Scenario: AC-006 only the owner sees the tile menu
    Given Avi owns room R and Dana shares her screen in its call
    When Avi and Dana look at each other's tiles
    Then Avi sees "Mute microphone", "Turn off camera", "Stop screen share" and "Remove from call" on Dana's tile
    And Dana sees no such menu on Avi's tile

  @AC-007
  Scenario: AC-007 what the muted and the removed see
    Given Dana is in room R's call
    When Avi mutes her, and later removes her
    Then she is told "The host muted you" and can unmute herself
    And then her window says "You were removed from the call" and she is still in room R
