Feature: The source-text renderer, and prefetch on visibility and press

  @AC-001
  Scenario: Hebrew and English, each marked with its language and direction
    Given the text API's recorded answer for "Genesis 1"
    When SourceText renders "Genesis 1" in the Hebrew interface
    Then the first block has lang "he" and dir "rtl" and starts with "בְּרֵאשִׁ֖ית"
    And the second block has lang "en" and dir "ltr"

  @AC-002
  Scenario: Markup from the API is rendered as text
    Given an answer whose segment is "<b>In</b> the <img src=x onerror=alert(1)>beginning &amp; more<script>x()</script>"
    Then the rendered text is "In the beginning & more"
    And there is no img, script or b element inside SourceText
    Given an answer that fails the schema
    Then SourceText says "Text unavailable"

  @AC-003
  Scenario: Fetch on visibility, once per ref
    Given two cards with the same ref below the fold
    Then no text request was made
    When they scroll within 200px of the viewport
    Then exactly one request for that ref was made

  @AC-004
  Scenario: Press prepares the room
    Given a live room's card and no socket open
    When the person presses the card's link
    Then one socket to that room is open
    And when 10 seconds pass without an enlarge, it is closed
