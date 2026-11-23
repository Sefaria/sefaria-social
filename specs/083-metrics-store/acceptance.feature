Feature: CI records metrics on the factory-data branch and the quality score is generated

  @AC-001
  Scenario: AC-001 build it from the Actions environment (run id, commit, workflow, job, result, duration, te
    Given the Actions environment of a CI job
    When metrics record runs with a job, result, duration and test count
    Then it prints one valid line carrying the run id and commit

  @AC-002
  Scenario: AC-002 create the factory-data branch as an orphan branch, and later writes SHALL append to metri
    Given a repository with no factory-data branch
    When two lines are recorded
    Then factory-data exists with its own history and both lines in order

  @AC-003
  Scenario: AC-003 refuse it
    Given a line without a job, and a whole-file publish to metrics/
    When they are written
    Then both are refused with the reason

  @AC-004
  Scenario: AC-004 write one line per job of the run except itself
    Given the jobs of a run
    When metrics from-run runs excluding metrics
    Then it writes one line per remaining job with its duration

  @AC-005
  Scenario: AC-005 run the metrics job after result, skip forks on purpose, and never fail the run because a 
    Given ci.yml
    When its metrics job is read
    Then it needs result, refuses forks in its if, has contents write, and runs the writer with --soft

  @AC-006
  Scenario: AC-006 write docs/QUALITY_SCORE.md with test files per level for each surface, and --check SHALL 
    Given a repository with a surface map and a test file
    When quality-score runs, a test is added, and --check runs
    Then the table shows the test, and --check fails with the fix
