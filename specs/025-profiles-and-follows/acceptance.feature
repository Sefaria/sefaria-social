Feature: Profiles and follows

  @AC-001
  Scenario: AC-001 the viewer's own profile is created on first use and can be edited
    Given a learner with no profile
    When they read their profile and then change their bio
    Then the first read creates it with their name, and the change is saved and answered

  @AC-002
  Scenario: AC-002 any profile with its latest posts
    Given an institution profile with two posts
    When a learner reads it
    Then it answers kind institution, its counts, whether the learner follows it, and its posts, and an unknown profile is 404

  @AC-003
  Scenario: AC-003 follow and unfollow
    Given a teacher's profile
    When a learner follows it twice and then unfollows, and tries to follow themself
    Then followers is 1 after following and 0 after unfollowing, and following oneself is refused

  @AC-004
  Scenario: AC-004 whom to follow
    Given institutions, popular people, a profile the learner already follows and the learner's own
    When the learner asks for suggestions
    Then up to 6 come back, institutions first, never the followed or their own

  @AC-005
  Scenario: AC-005 the profile page and Who to follow
    Given a learner on /social and a suggested institution
    When they follow it from the rail and open its profile
    Then the button turns to Following at once, the profile page shows its kind, bio, counts and posts, and their own profile has no Follow button

  @AC-006
  Scenario: AC-006 editing the profile and posting as an institution
    Given a learner who administers a beit midrash
    When they save a new bio in settings and open the composer
    Then settings says it saved, and the composer offers Post as with their name and the beit midrash
