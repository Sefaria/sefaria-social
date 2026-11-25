Feature: The shiur asset, only the leader recorded, the talking head kept, open by link, media in an object store

  @AC-001
  Scenario: AC-001 only the leader's microphone
    Given the leader records with two others in the call
    When the others speak, join and leave
    Then the recording's audio is fed only the leader's microphone

  @AC-002
  Scenario: AC-002 only the leader's camera
    Given the leader records with others whose cameras are on
    Then only the leader's camera is drawn, and the title card while it is off

  @AC-003
  Scenario: AC-003 the talking head's place
    Given the leader records with their camera on and the call window at the bottom right
    When they move the window and turn the camera off
    Then the timeline's social.overlay slice says each place and the camera's state

  @AC-004
  Scenario: AC-004 open to anyone with the link
    Given a ready recording
    When someone signed out asks for its asset, state and media
    Then they get them
    And a recording still recording, failed or unknown is 404
    And listing the room's recordings still needs membership

  @AC-005
  Scenario: AC-005 media in the object store
    When the recorder uploads chunks 0 and 1 and retries chunk 1
    Then the object store holds recordings/<id>/raw/0 and raw/1
    And Postgres keeps only the count and the last chunk's hash
    And deleting the recording removes both objects

  @AC-006
  Scenario: AC-006 old recordings go
    When the migration runs
    Then earlier recordings are gone and the media chunk table is dropped
