Feature: Processing a recording into its asset, a seekable file, its audio, a manifest and chapters

  @AC-001
  Scenario: AC-001 queued when finished
    When the leader finishes a recording
    Then it is queued for processing, and plays from its raw chunks meanwhile

  @AC-002
  Scenario: AC-002 the processed files
    When the queued recording is processed
    Then media.webm knows its duration, audio.m4a, timeline.json and manifest.json are there, and the raw chunks are gone

  @AC-003
  Scenario: AC-003 chapters
    Given the leader stayed on Genesis 1, skimmed Genesis 2 for half a second, and stayed on Exodus 3
    Then the chapters are Genesis 1 at 0 and Exodus 3 where the leader reached it

  @AC-004
  Scenario: AC-004 byte ranges
    When a player asks for bytes 0-99 of the processed media
    Then it gets 206 with Content-Range "bytes 0-99/<size>"
    And a range past the end is 416, and no range is the whole file

  @AC-005
  Scenario: AC-005 twice, and failing
    When processing runs twice, the files are the same
    When the media cannot be processed, it is tried three times with waits between, then failed, and still plays raw

  @AC-006
  Scenario: AC-006 ffmpeg and the worker
    Then the server image has ffmpeg, and the health check starts the processing worker
