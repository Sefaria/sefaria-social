Feature: People start, find, invite to, rename, delete and leave rooms from the interface

  @AC-001
  Scenario: AC-001 starting a room
    Given P is signed in on /social
    When P presses Start a room, types "Daf Yomi chavruta" and presses Start
    Then a room named "Daf Yomi chavruta" exists with P as owner and P is on its lobby
    And Start is disabled while the name is blank, and a failed create keeps the dialog open with an error

  @AC-002
  Scenario: AC-002 the rooms page
    Given P owns room A and is a member of room B
    When P opens Rooms in social's navigation
    Then /social/rooms lists B and A newest first, A marked Owner and B marked Member, each linking to its lobby
    And with no rooms it says "You are not in any room yet." and signed out it asks P to sign in

  @AC-003
  Scenario: AC-003 inviting people from the lobby
    When member M opens room R's lobby
    Then "Invite people" shows R's full link with Copy and Share, and the lobby says whether M owns R

  @AC-004
  Scenario: AC-004 renaming a room
    When owner O renames R to "Mishnah Berurah" in room settings
    Then the lobby's title is "Mishnah Berurah" and the API returns that title
    And Save is disabled for a blank name and a failure is reported

  @AC-005
  Scenario: AC-005 deleting a room
    When owner O presses Delete room and confirms
    Then any session of R in this browser is closed, R no longer exists, and /social/rooms says "“Title” was deleted."

  @AC-006
  Scenario: AC-006 leaving a room
    When member M presses Leave room and confirms
    Then M is no longer a member of R and /social/rooms says "You left “Title”."
    And the owner is not offered Leave room

  @AC-007
  Scenario: AC-007 ways in and back
    Then the home rail offers Start a room and All rooms to a signed-in person
    And a recording's page links back to its room's lobby
