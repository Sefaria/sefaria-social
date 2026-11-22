Feature: A weekly retro reports the factory's numbers and last week's actions

  @AC-001
  Scenario: AC-001 report job runs and the change from the previous week, failure rate, skips and median dura
    Given fixture metrics for two weeks
    When the retro script runs for the later week
    Then it reports the runs with the change, the per-job table and the flaky count

  @AC-002
  Scenario: AC-002 report each as done, not done or dropped, and list every job that failed in more than one 
    Given a previous retro with three action items
    When the retro script runs
    Then each item's state is reported, and spec-gate is listed as failing in two weeks

  @AC-003
  Scenario: AC-003 list it in the retro and exit 1
    Given a metrics file with a broken line
    When the retro script runs
    Then it lists the line and exits 1

  @AC-004
  Scenario: AC-004 find them identical and marked as a fixture
    Given docs/retros/2026-W48.md
    When the script runs on the fixture metrics with --fixture
    Then the outputs are identical and say FIXTURE RUN

  @AC-005
  Scenario: AC-005 compute and publish the numbers without any secret, and run the retro agent only when its 
    Given retro.yml
    When it is read
    Then the numbers job reads no secret and the agent job is gated on the preflight
