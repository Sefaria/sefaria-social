Feature: The shiur player, a bar at the bottom with chapters, the talking head where the leader had it, open to anyone

  @AC-001
  Scenario: AC-001 the bar
    When a shiur plays in the reader
    Then a bar at the bottom has play, the seek bar with a marker per chapter, back and forward, speed, Hide video and Close

  @AC-002
  Scenario: AC-002 chapters
    Then the marker at 0:08 is named "Go to Exodus 3 (0:08)"
    When it is clicked
    Then the shiur is at 0:08 and the bar says Exodus 3 is playing

  @AC-003
  Scenario: AC-003 the talking head
    Then the video is where the leader had their head, moves when they moved it, and is gone while their camera was off
    And Hide video hides it, and an audio-only shiur has no video and no Hide video

  @AC-004
  Scenario: AC-004 signed out
    When someone signed out plays a ready shiur from its link
    Then it loads through the public reads

  @AC-005
  Scenario: AC-005 keyboard
    When the bar has focus
    Then Space plays and pauses and the arrows move 5 seconds
