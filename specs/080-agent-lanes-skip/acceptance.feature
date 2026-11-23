Feature: Agent lanes run capped and skip cleanly without credentials

  @AC-001
  Scenario: AC-001 skip the lane with a notice naming the missing secret and docs/runbooks/setup-checklist.md
    Given no Anthropic credential is configured
    When the preflight of the review, QA, security or retro lane runs
    Then it prints a notice naming ANTHROPIC_API_KEY and the setup checklist
    And it writes run=false and exits 0

  @AC-002
  Scenario: AC-002 skip the security review, whatever credentials exist
    Given an API key is configured
    When the security review preflight runs for a pull request from a fork
    Then it writes run=false with the rule forks

  @AC-003
  Scenario: AC-003 run the review lane with the model in the REVIEWER_MODEL variable, or an Opus-class defaul
    Given an API key is configured
    When the review preflight runs with and without REVIEWER_MODEL
    Then it writes run=true and the model from REVIEWER_MODEL, else claude-opus-5-5

  @AC-004
  Scenario: AC-004 fail factory doctor with rule agent-jobs
    Given a workflow whose agent job has no turn limit, no time limit, no preflight gate and reads a deploy secret
    When factory doctor runs
    Then it reports each problem under agent-jobs
    And the repository's own workflows pass agent-jobs

  @AC-005
  Scenario: AC-005 fail factory doctor with rule workflows
    Given a workflow job with no time limit and an unpinned third-party action
    When factory doctor runs
    Then it reports both under workflows
    And the repository's own workflows pass workflows

  @AC-006
  Scenario: AC-006 skip and exit 0 for every one of them
    Given the repository's agent workflows
    When each preflight step runs with its env block and no secrets
    Then every one writes run=false and exits 0
