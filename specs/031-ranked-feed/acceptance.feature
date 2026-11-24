Feature: For you, ranked

  @AC-001
  Scenario: AC-001 engagement and the network decide the order
    Given two posts of the same age, one with replies, reposts and a quote and one with none, and one from a stranger
    When the viewer opens For you
    Then the engaged post is first and the stranger's quiet post is last

  @AC-002
  Scenario: AC-002 one author does not fill the page
    Given an author with many posts and another with one
    When the viewer opens For you
    Then the other author's post is not pushed below all of the first author's

  @AC-003
  Scenario: AC-003 the conversation puts the author first
    Given replies from a stranger, a followed profile and the post's author
    When the viewer reads the post
    Then the author's reply is first, the followed profile's second

  @AC-004
  Scenario: AC-004 the scoring is X's sum
    Given candidates with known counts
    When they are ranked
    Then the weights, out-of-network scaling, decay and author diversity are applied as specified
