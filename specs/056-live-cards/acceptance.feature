Feature: A posted room or broadcast card shows, live, the text its leader is on

  @AC-001
  Scenario: AC-001 the relay reports changes, at most once per 5 seconds per room
    Given a room on the relay with a server URL configured
    When the leader publishes Genesis 1, then Genesis 2 a second later, then Genesis 3 a second after that
    Then the server receives a report for Genesis 1 at once and one for Genesis 3 five seconds after the first
    And no two reports for the room are less than 5 seconds apart
    And with nothing changing a report is still sent within a minute
    When the last person leaves
    Then a report with nobody connected is sent

  @AC-002
  Scenario: AC-002 the server checks and keeps reports
    When a report arrives without a signature, with a wrong one, or with a timestamp 6 minutes old
    Then each is refused with 401
    When a signed report for room R arrives, then a newer one
    Then the newer one is kept
    And a signed report for an unknown room is ignored

  @AC-003
  Scenario: AC-003 the public live endpoint
    Given posts embedding room R (reported live on Genesis 2), broadcast B and recording C, and a room S no post embeds
    When a signed-out client asks for R, B, C and S
    Then it gets R live on Genesis 2 with its Hebrew ref and the number there, B and C not live, and nothing for S
    And a report older than 3 minutes is not live
    And 50 ids are answered in one response and 51 are refused with 400
    And asking again with the ETag it got answers 304

  @AC-004
  Scenario: AC-004 polling only what is seen, only while visible
    Given a timeline with three live cards, one of them off screen
    Then one request every 15 seconds asks for the two on screen
    And when the tab is hidden no request is sent until it is visible again
    And the card shows Live, the ref and its text, or Not live with the last ref

  @AC-005
  Scenario: AC-005 a room card follows the leader within 20 seconds
    Given the leader of room R is on Genesis 1 and a post embeds R
    When the leader moves to Genesis 2
    Then within 20 seconds the card in the viewer's feed shows Genesis 2
