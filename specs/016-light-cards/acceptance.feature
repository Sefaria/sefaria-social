Feature: Light cards — a room's place and who is there, with no reader and no socket

  @AC-001
  Scenario: A card is an article with one stretched link
    Given the feed holds the live room "Bereshit together" and the shiur "Daf Yomi"
    Then each card is an article labelled by its heading
    And each card has exactly one link, inside its heading
    And the room's link points at "/social/r/<id>" and the shiur's at "/social/s/<id>"

  @AC-002
  Scenario: Status in words, ref in the interface language
    Given a live room with 3 people reading "Genesis 1" (heRef "בראשית א׳")
    Then its card says "Live" and "3 learning" in text
    And the dot next to it is hidden from assistive technology
    When the interface language is Hebrew
    Then the card shows "בראשית א׳" with lang "he" and dir "rtl"

  @AC-003
  Scenario: A feed of live cards opens no sockets
    Given three live rooms in the viewer's feed
    When the viewer opens "/social" and the three cards are shown
    Then no WebSocket was opened and no reader was mounted

  @AC-004
  Scenario: The stream's summary carries the Hebrew ref
    Given a publisher reading "/Genesis.1"
    When the text API has answered for "Genesis 1"
    Then the published summary is {ref "Genesis 1", heRef "בראשית א׳", title "Genesis"} without another move
    And the relay's status read and the server's status carry heRef "בראשית א׳"

  @AC-005
  Scenario: Visual checks
    Given a feed with one live room, one scheduled shiur and one recent room
    Then screenshots of the feed in English, Hebrew and dark match their baselines
