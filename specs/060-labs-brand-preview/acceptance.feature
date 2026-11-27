Feature: Social wears the Sefaria Labs brand — a visual preview

  @AC-001
  Scenario: AC-001 the frame takes Daylight or Night from the reader's theme
    Given the reader's theme is light
    When the feed renders
    Then social's frame is painted #FFFFFF with text #1B2233
    And the reader's own page keeps its colours
    When the reader's theme is dark
    Then social's frame is painted #0B1426 with text #F2EDE3
    And every text colour has at least 4.5:1 contrast on its page
    And page headings are in the serif face

  @AC-002
  Scenario: AC-002 the frame carries the Social mark and the Labs byline
    When the frame renders in English
    Then the Social mark is beside the nav and hidden from assistive technology
    And "from Sefaria Labs" is shown
    When the interface language is Hebrew
    Then the byline is in Hebrew with lang "he" and dir "rtl"

  @AC-003
  Scenario: AC-003 the system speaks in mono, people in the serif
    Given a post anchored to Genesis 1:3
    When the timeline renders
    Then the ref, the post's time and its counts are in the mono face
    And the post's words and its author's name are in the serif
    And the nav, the tabs and the section labels are in the mono face, in capitals

  @AC-004
  Scenario: AC-004 teal means live, gold means warmth, violet means AI
    When a live room card, an unread count and a given Yasher koach render
    Then the live card uses the teal
    And the unread count and the Yasher koach use the gold
    And no stylesheet uses the violet

  @AC-005
  Scenario: AC-005 every learner wears a cursor colour
    When avatars for different people are drawn
    Then each ring colour comes from the Labs cursor set, never teal or violet
    And the same person gets the same colour every time
    And every ring has at least 3:1 contrast on white

  @AC-006
  Scenario: AC-006 questions stand out
    Given a post "why does it say vayishlach yaakov?"
    When the timeline renders
    Then the post carries a "Question" label
    And a post that does not end with a question mark carries none

  @AC-007
  Scenario: AC-007 small moments of delight, and none with reduced motion
    When a live dot is shown
    Then it pulses
    When reduced motion is asked for
    Then the dot and the Yasher koach do not animate
