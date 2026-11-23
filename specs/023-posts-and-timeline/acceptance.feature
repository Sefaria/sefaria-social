Feature: Posts and the timeline

  @AC-001
  Scenario: AC-001 a learner posts a Torah thought anchored to a source
    Given a signed-in learner
    When they post "Light came before the luminaries" with the source "Genesis 1:3"
    Then the answer is 201 with the post, its author is the learner's profile, and an empty body, a too-long body or posting as an institution they do not run is refused

  @AC-002
  Scenario: AC-002 the timeline shows followed profiles' posts and the viewer's own, newest first, in pages
    Given posts by a followed teacher, an unfollowed learner and the viewer, and a deleted post
    When the viewer reads the Following tab, then the Everyone tab, then the next page
    Then Following holds the teacher's and the viewer's posts, Everyone holds all of them, pages hold at most 20 and the last says so, and the deleted post is in neither

  @AC-003
  Scenario: AC-003 one post with its replies, and deleting it
    Given a post with two replies
    When anyone reads it, a stranger deletes it, then its author deletes it
    Then the read has the replies oldest first, the stranger is refused, the author's delete answers 204, and the post is gone

  @AC-004
  Scenario: AC-004 the composer and the timeline on /social
    Given a signed-in learner on /social reading Genesis 1 in the reader
    When they type a thought and post it
    Then the source field was pre-filled with Genesis 1, the post appears at the top of Following, Everyone shows all posts, and an empty timeline invites them to follow or post

  @AC-005
  Scenario: AC-005 a post's source and its own page
    Given a post anchored to Genesis 1:3
    When the learner opens it from the timeline and presses its source
    Then the post page shows the post and the source text, the source opens in the reader, and an unknown post id shows social's not-found page

  @AC-006
  Scenario: AC-006 language, direction, time and keyboard
    Given the Hebrew interface and a post written in English
    When the timeline renders
    Then the frame is right to left, the post body keeps its own direction, times are relative in Hebrew with the full date in datetime, and every control is reachable by keyboard
