Feature: Holdout scenarios are judged in three clean trials without leaking their text

  @AC-001
  Scenario: AC-001 check id, title, story, persona, start path and at least two rubric lines with a known dim
    Given a valid scenario and an invalid one
    When they are validated
    Then the valid one passes without its text printed, and the invalid one names its problems

  @AC-002
  Scenario: AC-002 require exactly three clean trials per scenario, grade every rubric line pass, fail or unk
    Given three clean trials with pass, unknown and fail grades
    When they are scored
    Then one of three is satisfied and the unknown is counted
    And a scenario with two clean trials fails scoring

  @AC-003
  Scenario: AC-003 write an issue body with the symptom and the observed steps and with any scenario or rubri
    Given a failed trial whose judge quoted a rubric line
    When issue bodies are written
    Then the body contains neither the story nor the rubric line

  @AC-004
  Scenario: AC-004 skip the holdout jobs with a notice naming what is missing
    Given Anthropic credentials but no holdout inputs
    When the holdout preflight runs
    Then it skips naming the deploy key, repository and staging URL

  @AC-005
  Scenario: AC-005 fail factory doctor
    Given agent-review.yml reading HOLDOUT_DEPLOY_KEY
    When factory doctor runs
    Then it reports the workflow under workflows
