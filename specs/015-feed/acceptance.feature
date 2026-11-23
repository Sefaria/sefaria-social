Feature: The feed — what is live, scheduled and recent for the viewer, at /social

  @AC-001
  Scenario: The feed groups the viewer's rooms and upcoming shiurim
    Given the viewer is a member of "Bereshit together", which has one person in it reading "Genesis 1"
    And the viewer is a member of "Mishnah circle", which has nobody in it
    And a public shiur starts tomorrow and a shiur of the viewer's room started yesterday
    When the viewer calls GET /api/v1/feed
    Then "live" holds "Bereshit together" with ref "Genesis 1", heRef "בראשית א׳" and 1 participant
    And "recent" holds "Mishnah circle"
    And "scheduled" holds only tomorrow's shiur

  @AC-002
  Scenario: The relay is down, the token is missing, and other people's rooms stay out
    Given the relay does not answer
    When the viewer calls GET /api/v1/feed
    Then the answer is 200 with every room in "recent" and nothing in "live"
    And a call without a token is 401
    And a room the viewer is not in, and a private shiur of that room, are absent

  @AC-003
  Scenario: The feed page shows three sections in order and reads again
    Given a signed-in viewer with one live room and one recent room
    When they open "/social"
    Then the headings are "Live now", "Scheduled" and "Recent" in that order
    And "Scheduled" says it has nothing yet
    When 30 seconds pass
    Then the feed was read a second time

  @AC-004
  Scenario: Signed out, and a failing feed
    Given a signed-out viewer
    When they open "/social"
    Then they see "Sign in to see your rooms" and a "Sign in" button
    And pressing it asks the reader to sign in, and no feed request was made
    Given a signed-in viewer whose feed request fails
    Then an alert says the feed could not be loaded

  @AC-005
  Scenario: Hebrew interface
    Given the interface language is Hebrew
    When the viewer opens "/social"
    Then the headings are in Hebrew inside an element with lang "he" and dir "rtl"
    And each section's cards are items of a list
