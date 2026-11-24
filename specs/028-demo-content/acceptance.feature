Feature: Demo content

  @AC-001
  Scenario: AC-001 the demo scenario seeds a living community, once
    Given an empty database
    When the demo scenario is seeded twice
    Then there are institutions, people, posts with sources, replies, reactions and follows, and the second run added nothing

  @AC-002
  Scenario: AC-002 the demo scenario for a real account
    Given the demo scenario
    When it is seeded for a user id
    Then that user follows the demo institutions and administers one of them
