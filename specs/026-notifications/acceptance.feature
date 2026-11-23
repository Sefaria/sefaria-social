Feature: Notifications

  @AC-001
  Scenario: AC-001 who is notified of what
    Given a learner, a teacher, an institution with an administrator, and the institution's followers
    When the learner follows the teacher, replies to and reacts to the teacher's post, and the institution posts
    Then the teacher gets follow, reply and reaction notifications, the followers get a post notification, and nobody is notified of their own action

  @AC-002
  Scenario: AC-002 reading and clearing notifications
    Given a teacher with three unread notifications
    When they read their notifications and then mark them read
    Then the answer lists them newest first with actors and posts and unread 3, and after marking unread is 0

  @AC-003
  Scenario: AC-003 the unread badge in social's navigation
    Given a teacher with two unread notifications
    When they open any social page
    Then the navigation shows Notifications with a badge of 2 whose accessible name includes the number

  @AC-004
  Scenario: AC-004 the notifications page
    Given a teacher with a follow and a reply notification
    When they open /social/notifications
    Then each is a sentence linking to its profile or post, unread ones are marked, and after the page is shown the badge is gone
