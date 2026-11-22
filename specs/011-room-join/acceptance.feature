Feature: Joining a room from its link, the room status passthrough, and the lobby's Join

  @AC-001
  Scenario: Joining with the link
    Given user 5151 owns a room and user 4242 is not a member
    When user 4242 posts to the room's members
    Then the response is 200 with role "member" and posting again answers the same
    And a room id that does not exist gets 404 "room.not_found"

  @AC-002
  Scenario: Leaving a room
    Given user 4242 is a member of user 5151's room
    When user 4242 deletes their membership
    Then the response is 204 and the room is no longer theirs
    And the owner trying to leave gets 403 "room.owner_cannot_leave"

  @AC-003
  Scenario: Status from the relay, or a quiet fallback
    Given the relay reports ref "Genesis 1" and 3 participants for the room
    When a member reads the room's status
    Then it is live with ref "Genesis 1" and 3 participants
    And with the relay down it is not live with 0 participants
    And a non-member gets 404

  @AC-004
  Scenario: Deletion reaches the relay
    Given user 4242 is a member of two rooms
    When the deletion webhook for 4242 is processed
    Then the relay is asked to drop 4242 from both rooms
    And with the relay failing the webhook still answers "processed" and logs relay_drop_failed

  @AC-005
  Scenario: Browsers on the reader's origin may call the API
    Given SOCIAL_ALLOWED_ORIGINS is "https://www.sefaria.org"
    When a preflight comes from https://www.sefaria.org and another from https://evil.example
    Then the first gets 204 with that origin allowed and the second gets no CORS headers

  @AC-006
  Scenario: Joining from the lobby
    Given a signed-in viewer on the lobby of a room they are not in
    When they press Join
    Then the room's title is shown
    And a signed-out viewer pressing Join is sent to sign in without an API call
