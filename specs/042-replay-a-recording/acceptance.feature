Feature: A recording plays back inside the reader, the video in the floating window driving the text

  @AC-001
  Scenario: AC-001 the lobby lists recordings and each has a page
    Given room R has a ready recording "Monday chavruta"
    When member M opens R's lobby and follows the recording's link
    Then the recording page shows its title, date, length, Play and Download state, and Delete only for whoever may delete it

  @AC-002
  Scenario: AC-002 Play opens the player in the reader
    When M presses Play
    Then the reader shows the recording's first text with ctx social.rec.<id> and the floating window shows the recording at 0

  @AC-003
  Scenario: AC-003 the reader follows the recording
    Given a recording whose state moves from Genesis 1 to Genesis 2 at 4 seconds
    When it plays past 4 seconds
    Then the reader shows Genesis 2, applied with origin playback and not persisted

  @AC-004
  Scenario: AC-004 pause, seek and speed move media and reader together
    When M pauses, drags the scrubber back to 1 second, steps forward 10 seconds and picks 2x
    Then the media and the reader are at the same point each time

  @AC-005
  Scenario: AC-005 reading around and coming back
    Given the recording is playing
    When M scrolls the reader
    Then the reader stops following, the media keeps playing and "Back to the recording" is offered
    When M presses it
    Then the reader is at the recording's current point again

  @AC-006
  Scenario: AC-006 a reload, and closing
    When the page with ctx social.rec.<id> is reloaded
    Then the player is open, paused at the start
    When M closes it
    Then the media stops, ctx is gone and the reader stays where it is

  @AC-007
  Scenario: AC-007 a replay and a call never share the window
    Given M is in R's call
    When M presses Play on a recording
    Then M is asked first, and on confirmation the call is left and the replay opens

  @AC-008
  Scenario: AC-008 a recording that cannot be loaded
    When M opens a recording that does not exist, or whose state is not a recording
    Then the window says it cannot be played and the reader is unchanged
