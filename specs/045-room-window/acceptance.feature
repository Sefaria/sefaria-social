Feature: You stay in a room while you read around, in a room window that looks and works like part of Sefaria

  @AC-001
  Scenario: AC-001 reading around keeps you in the room
    Given the leader L is in room R's context on Genesis 1
    When L follows a link in the reader to /texts/Tanakh
    Then the address is /texts/Tanakh with ctx=social.room.R and L is still in R, leading
    And Back to the lobby, or another room's address, still leaves R's context

  @AC-002
  Scenario: AC-002 a follower who reads around stays in the room
    Given follower F follows L in R
    When F follows a link in the reader
    Then F is in R on their own with Follow again, and Follow again takes F to L's place

  @AC-003
  Scenario: AC-003 the room window
    When the reader is in R's context
    Then a card at the bottom inline-start corner shows R's title, the status, Lead or Follow again, the room's page, Minimise and who is here

  @AC-004
  Scenario: AC-004 collapsing the room window
    When the viewer collapses the room window
    Then it is a pill with R's title and the status, and stays collapsed on the next page until expanded

  @AC-005
  Scenario: AC-005 a live room you are not in
    Given the viewer minimised R
    Then the card says R's title with Return to the room and Leave

  @AC-006
  Scenario: AC-006 calls off
    Given the server does not offer calls
    When a member opens R's lobby
    Then it says "Video calls are not turned on here."
