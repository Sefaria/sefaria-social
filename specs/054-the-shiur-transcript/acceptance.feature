Feature: A shiur's transcript from Sofer.ai, in the leader's language, shown line by line in the player

  @AC-001
  Scenario: AC-001 a transcript is made
    Given a Sofer.ai key is set
    When a recording has been processed
    Then its audio goes to Sofer.ai, the job polls until it is done
    And the asset's state says the transcript is ready and the manifest names it

  @AC-002
  Scenario: AC-002 public reads
    When someone signed out asks for a ready shiur's transcript and its audio
    Then both answer, the audio by byte range too
    And before the transcript is ready its read answers 404 recording.no_transcript

  @AC-003
  Scenario: AC-003 the leader's language
    When the leader chooses Hebrew beside Record and records
    Then the choice is remembered and Sofer.ai is asked for Hebrew

  @AC-004
  Scenario: AC-004 no key
    Given no Sofer.ai key is set
    When a recording has been processed
    Then its transcript is unavailable, nothing is sent, and the shiur plays

  @AC-005
  Scenario: AC-005 Sofer.ai fails
    When Sofer.ai says the transcript failed
    Then the transcript is failed and the asset is as it was

  @AC-006
  Scenario: AC-006 the line in the player
    When a shiur with a ready transcript plays
    Then the line being said is under the bar with the word being said marked
    And Transcript hides and shows it
