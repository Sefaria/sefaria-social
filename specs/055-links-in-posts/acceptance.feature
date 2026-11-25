Feature: Links in posts become links, and a room, broadcast or recording link becomes a card under the post

  @AC-001
  Scenario: AC-001 a pasted room link becomes a card, and removing it restores the text
    Given the composer is open
    When the viewer types "Join us " and pastes "https://www.sefaria.org/social/r/<room id>"
    Then the text is "Join us " and a room card with a remove button is under it
    When the viewer presses remove
    Then the text is "Join us https://www.sefaria.org/social/r/<room id>" and there is no card
    And a second room link in the same text stays text while a card is shown

  @AC-002
  Scenario: AC-002 the server checks the embedded target
    Given room R owned by O, broadcast B and recording C
    When a user posts with embed room R, with embed broadcast B with empty text, and with embed recording C
    Then each answers 201 with embed kind, id, title and the leader's name
    When a user posts with an embed whose id is unknown
    Then it answers 404 and no post was created
    And a post with empty text and no embed is refused with 400

  @AC-003
  Scenario: AC-003 posts without an embed are unchanged
    When a user posts without an embed and reads it back from the timeline and its page
    Then the post has exactly the fields it had before this spec and no embed field

  @AC-004
  Scenario: AC-004 URLs in a post are links
    Given a post "see https://example.org/a?b=1 and javascript:alert(1)"
    Then "https://example.org/a?b=1" is a link with rel "noopener nofollow" and target "_blank"
    And "javascript:alert(1)" is text

  @AC-005
  Scenario: AC-005 the card in a post
    Given posts embedding a room, a broadcast, a recording and a room that was deleted
    Then the cards show the title, the leader's name and Join, Watch and Play
    And pressing Join navigates the host to /social/r/<room id>
    And the deleted room's card says it is no longer available and has no button
