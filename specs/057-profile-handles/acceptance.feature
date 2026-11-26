Feature: Every profile has an @handle, unique and editable in settings, shown wherever the person shows themselves

  @AC-001
  Scenario: AC-001 a handle on first use
    When "Rachel Cohen" signs in for the first time and "rachel_cohen" is taken
    Then her profile's handle is "rachel_cohen2"
    And a name with no Latin letters gives a handle starting with "learner"

  @AC-002
  Scenario: AC-002 changing the handle
    When she saves the handle "@Rachel_C"
    Then her handle is "rachel_c"
    And "ab", "1abc", "admin" and "has space" are refused as invalid, and another profile's handle as taken

  @AC-003
  Scenario: AC-003 the handle in answers
    Then her profile, her posts' author and the by-handle read all carry "rachel_c"

  @AC-004
  Scenario: AC-004 the settings field
    When she types a taken handle in settings and saves
    Then "That handle is taken" is shown under the Handle field and her text stays

  @AC-005
  Scenario: AC-005 shown beside the name
    Then her profile page and her posts show "@rachel_c" beside her name
