Feature: A source beside the feed

  @AC-001
  Scenario: AC-001 the source of a post opens beside the page
    Given a post anchored to a source in the timeline, with a reader that offers openBeside
    When the learner clicks the source
    Then the reader is asked to open the source's address beside the page and the page stays where it was, and with a 1.0 reader the source opens with commands.go

  @AC-002
  Scenario: AC-002 the page lays out by its own width
    Given the home page in a frame 480px wide on a wide window
    When it renders
    Then the timeline and the rail are one column, as on a phone
