Feature: Replies and reactions

  @AC-001
  Scenario: AC-001 replying to a post and deleting the reply
    Given a post
    When a learner replies, a stranger deletes the reply, then its author deletes it
    Then the reply is stored and counted, the stranger is refused, the author's delete answers 204, and replies to a missing post or with an empty body are refused

  @AC-002
  Scenario: AC-002 reacting is idempotent and reversible
    Given a post
    When a learner reacts twice and then removes the reaction
    Then the count is 1 after both reactions and 0 after the removal, and reacting to a missing post is refused

  @AC-003
  Scenario: AC-003 Yasher koach updates at once and rolls back on failure
    Given a post in the timeline
    When the learner presses Yasher koach and the server accepts, then presses it again and the server refuses
    Then the first press shows pressed with count 1 before the answer, and the refused press returns to the earlier state and says so

  @AC-004
  Scenario: AC-004 replies on the post page
    Given a post with one reply
    When the learner opens its page and sends a reply
    Then both replies are listed oldest first, the new one appears at once, the reply count goes up, and only its author sees Delete on it
