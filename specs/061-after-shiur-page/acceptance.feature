Feature: Revisit a finished shiur
  @AC-006
  Scenario: Revisit the complete class artifact layout
    Given a recording with text chapters and no saved annotations or synthesis
    When I select the next source in the reading workspace
    Then the source changes and the itinerary remains available
    And summary, shared margins, chiddushim, questions and next learning show explicit empty states
  @AC-001
  Scenario: A class returns to its first text
    Given chapters A, B, A
    When I open the recording page
    Then the itinerary contains A, B, A and the bibliography contains A, B
  @AC-002
  Scenario: Search and revisit a transcript moment
    Given a ready timestamped transcript
    When I search for a phrase and choose its timestamp
    Then the recording plays from that moment
  @AC-003
  Scenario: A transcript is not yet ready
    Given an asset with pending transcription
    When I open the recording page
    Then I see a processing message and the page checks again
  @AC-004
  Scenario: Return to Social from a recording
    Given a recording associated with a room
    When I choose Back to Social
    Then host navigation returns to the Social home
  @AC-005
  Scenario: Finish a recorded room
    Given I am recording a room
    When finalization succeeds and I close the room
    Then I arrive at the recording page
  @AC-005
  Scenario: Finalization fails
    Given I am recording a room
    When finalization fails
    Then the room stays open and no completed recording page opens
