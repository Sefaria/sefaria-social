Feature: Invite people to a room by @handle from a bar in the room, with suggestions, and they are told in Social

  @AC-001
  Scenario: AC-001 the invite request
    When a member invites "@ben", "@member", "@me", "@nobody" and "!!" to the room
    Then the answers are invited, member, self, not_found and invalid
    And someone outside the room is answered 404, and 21 entries 400

  @AC-002
  Scenario: AC-002 the invitation in activity
    When Ben is invited twice within a day
    Then his activity has one "Rachel invited you to Daf Yomi" with Join, which opens the room's lobby

  @AC-003
  Scenario: AC-003 the rate limit
    When a member has invited 50 people in the last hour
    Then the next invitation is refused with 429 and retry-after

  @AC-004
  Scenario: AC-004 people search
    When a viewer searches "@be"
    Then up to 8 people are answered, those whose handle starts with "be" first, with id, handle, name and kind only

  @AC-005
  Scenario: AC-005 the invite bar
    When a member types "be", picks Ben from the suggestions, types "@nobody", presses Enter and Send invites
    Then Ben's chip says Invited and the "@nobody" chip stays, marked not found
