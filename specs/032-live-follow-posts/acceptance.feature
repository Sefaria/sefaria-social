Feature: A live follow-me session in a post

  @AC-001
  Scenario: AC-001 a post keeps the session a follow link carries
    Given a teacher learning live with follow me
    When they post its link in their words or as the source
    Then the post carries the session and the source the link opened on

  @AC-002
  Scenario: AC-002 the post says where the leader is now
    Given a post sharing a live session
    When two viewers ask where it is within a few seconds
    Then both hear the leader's current source, name and count, and the relay was asked once

  @AC-003
  Scenario: AC-003 an ended session, or no relay, is not live
    Given a post sharing a session that has ended
    When a viewer asks where it is
    Then the answer is not live, and a post without a session is not found

  @AC-004
  Scenario: AC-004 the card follows the leader and joins the shiur
    Given a post sharing a live session in the timeline
    When the leader moves on and the learner presses Join the shiur
    Then the card shows the new source, and the reader opens there with the follow link
