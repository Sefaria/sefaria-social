Feature: A room's owner records the live session, its reader state together with the call's audio and video

  @AC-001
  Scenario: AC-001 only the owner starts a recording, once
    Given room R owned by O with member M and outsider X
    When O, M and X each post a recording for R, and O posts a second one
    Then O gets 201 with an id in status "recording", M gets 403, X gets 404, and O's second start gets 409
    And with RECORDINGS_ENABLED=false a start gets 503 "recording.unavailable"

  @AC-002
  Scenario: AC-002 chunks and state batches are stored in order and checked
    Given O is recording R
    When O uploads media chunks 0 and 1 and state messages with seq 0..3
    Then they are stored
    And chunk 3 before 2, a chunk over 4 MB, a chunk from M, a state batch with a bad message or a seq gap are refused with nothing stored

  @AC-003
  Scenario: AC-003 finishing, and a recording whose recorder went away
    Given a recording with chunks and state
    When O posts finish with durationMs 12000
    Then it is "ready" with duration 12000
    And a recording with no upload for 2 minutes reads as "ready", and one with nothing uploaded is gone

  @AC-004
  Scenario: AC-004 members list and read recordings
    Given R has two recordings
    When M lists them and reads the newest one's state and media
    Then they come newest first, the state parses as Recording v1, and the media is the chunks in order with the recorded type
    And X gets 404 for each

  @AC-005
  Scenario: AC-005 deleting recordings, and deleting the user
    Given a recording by O in R
    When M deletes it, then O deletes it
    Then M gets 403 and O's delete removes it and its chunks
    And when user O is deleted, their recordings are gone and the schema walk finds no rows for O

  @AC-006
  Scenario: AC-006 everyone in the room is told it is being recorded
    Given O is recording R and M is in R's lobby and call
    Then R's read and status say recording, the lobby says "Recording", the call window shows the Recording badge and the pre-join step says the call is being recorded
    When O stops
    Then none of these show

  @AC-007
  Scenario: AC-007 the recorder captures state and media on one clock
    Given O is in R's session and call
    When O presses Record, moves the reader, waits, and presses Stop
    Then the server holds media chunks, a state track that starts with a keyframe and ends with one, and the recording is "ready"

  @AC-008
  Scenario: AC-008 uploads that keep failing stop the recording
    Given O is recording and the server refuses every upload
    When three uploads in a row fail
    Then the recorder stops, O sees that the recording stopped, and what was stored is kept
