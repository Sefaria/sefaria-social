Feature: Invite by email from the same bar; a Sefaria user is told in Social, anyone else gets an email with the room's link

  @AC-001
  Scenario: AC-001 an address with an account
    Given Sefaria says ben@example.org is Ben's
    When a member invites ben@example.org
    Then Ben has the room_invite notification and no email is sent

  @AC-002
  Scenario: AC-002 an address without an account
    When members invite new@example.org twice in a day, from two rooms
    Then one email is sent, naming the inviter, the room and its link, escaped

  @AC-003
  Scenario: AC-003 no telling who has an account
    Then both answers are invited at once, even while the provider is slow
    And no table holds either address, only keyed hashes, and old rows are removed

  @AC-004
  Scenario: AC-004 no provider key
    Given no email provider key is set
    When a member invites an address
    Then it is unavailable, nothing is looked up, and the bar says email invites are not available

  @AC-005
  Scenario: AC-005 failures and limits
    When the provider fails for one address
    Then every entry is answered invited, the failure is logged, and the other address is emailed
    And requests sent together cannot pass the hourly limit
