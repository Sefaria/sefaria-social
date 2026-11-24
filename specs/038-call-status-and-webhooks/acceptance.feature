Feature: Cards and the lobby show who is on a call, and a deleted account leaves every call

  @AC-001
  Scenario: AC-001 unsigned webhooks are refused
    Given a LiveKit webhook body for room R
    When it is posted without a signature, and with a wrong one
    Then both answers are 401 and room R's call status is unchanged

  @AC-002
  Scenario: AC-002 a repeated event applies once
    Given a signed participant_joined event for room R with event id E
    When it is posted twice
    Then it is applied once and webhook_receipts holds E once

  @AC-003
  Scenario: AC-003 joins, leaves and the end of a call
    Given room R exists
    When signed events arrive: joined (1 participant), joined (2), left (1), left out of order (0), room finished
    Then room R's call status goes live with 2, then 1, then 0 and never below, and is not live after room finished
    And an event for a room that does not exist changes nothing

  @AC-004
  Scenario: AC-004 the lobby and cards show the call
    Given room R's call is live with 3 participants
    When Dana opens room R's lobby and the feed with room R's card
    Then both show "3 on a call"
    And when the call ends neither shows it and the status has no call field, and with LiveKit not configured nothing errors

  @AC-005
  Scenario: AC-005 a deleted account leaves every call
    Given Dana is in room R's live call and room S's call is live
    When the user-deleted webhook for Dana is handled
    Then the server asks LiveKit to remove "u:<Dana's id>" from rooms R and S
    And a failed removal is retried once, logged, and the rest of the deletion still completes

  @AC-006
  Scenario: AC-006 nothing of the user remains
    Given every table seeded with rows for Dana
    When Dana's account deletion is handled
    Then no table holds a row for Dana
