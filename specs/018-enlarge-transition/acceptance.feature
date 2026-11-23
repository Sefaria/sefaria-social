Feature: Enlarge from a card onto the card's source, with a transition and no reload

  @AC-001
  Scenario: Pressing a live card lands on its source without a reload
    Given the feed shows the live room "Bereshit together" reading "Genesis 1"
    When the viewer clicks the card's link
    Then the host was told to push "/Genesis.1?ctx=social.room.<id>"
    And the reader's last applied snapshot is at the card's ref "Genesis 1"
    And the page was not reloaded
    When the viewer goes Back
    Then they are on "/social"

  @AC-002
  Scenario: A view transition where supported, a transform elsewhere
    Given a browser with document.startViewTransition
    When the viewer enlarges from a card
    Then the enlarge ran inside a view transition naming the card
    Given a browser without it
    Then the card was animated with transform and clip-path before the enlarge

  @AC-003
  Scenario: Reduced motion
    Given the viewer prefers reduced motion
    When they enlarge from a card
    Then no animation and no view transition ran

  @AC-004
  Scenario: Modified clicks are links
    When the viewer Ctrl-clicks a live card's link
    Then nothing was enlarged
