Feature: Repost and quote

  @AC-001
  Scenario: AC-001 a repost is recorded once and can be undone
    Given a post by a teacher
    When a learner reposts it twice and then undoes it
    Then the count goes to one, stays one, and returns to zero

  @AC-002
  Scenario: AC-002 a quote carries the quoted post
    Given a post by a teacher
    When a learner posts a quote of it
    Then the quote comes back with the teacher's post inside it and the teacher's post counts one quote

  @AC-003
  Scenario: AC-003 the network's reposts are in Following
    Given a viewer who follows a learner who reposted a stranger's post
    When the viewer opens Following
    Then the stranger's post is there once, saying the learner reposted it

  @AC-004
  Scenario: AC-004 the post card offers repost and quote
    Given a post in the timeline
    When the learner presses repost and then quotes it
    Then the button shows reposted with the new count, and the quote form posts a quote of it

  @AC-005
  Scenario: AC-005 the demo community reposts and quotes
    Given the demo scenario
    When it is seeded
    Then it has reposts and quotes
