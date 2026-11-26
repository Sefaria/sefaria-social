Feature: Invite by email from the same bar; a Sefaria user is told in Social, anyone else gets an email with the room's link

  @AC-001
  Scenario: AC-001 an address with an account
    Given Sefaria says ben@example.org is Ben's
    When a member invites ben@example.org
    Then Ben has the room_invite notification and no email is sent

  @AC-002
  Scenario: AC-002 an address without an account
    When a member invites new@example.org twice in a day
    Then one email is sent, naming the inviter, the room and its link, escaped

  @AC-003
  Scenario: AC-003 no telling who has an account
    Then both answers are invited and no table holds either address

  @AC-004
  Scenario: AC-004 no provider key
    Given no email provider key is set
    When a member invites an address
    Then it is unavailable, nothing is looked up, and the bar says email invites are not available

  @AC-005
  Scenario: AC-005 a failure
    When the provider fails for one address
    Then that entry is failed and the others are answered as usual
