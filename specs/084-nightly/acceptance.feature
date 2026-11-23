Feature: The nightly finds flaky and uncollected tests and keeps quarantines honest

  @AC-001
  Scenario: AC-001 list every test whose result differs between runs and fail when one is not quarantined
    Given three reports where one test passed, failed, passed
    When flake detection runs
    Then it lists that test with its results and fails

  @AC-002
  Scenario: AC-002 fail the collection check, naming the file and its level
    Given test files in unit and e2e paths of which one ran
    When the collection check runs
    Then it names each file that did not run with its level

  @AC-003
  Scenario: AC-003 fail the quarantine check
    Given a quarantine entry that expired
    When the quarantine check runs
    Then it fails naming the expiry

  @AC-004
  Scenario: AC-004 report a notice and not fail, and WHEN a test that is not quarantined fails
    Given a valid quarantine entry
    When reports with the quarantined test failing, then another test failing
    Then the first is a notice with exit 0, the second exits 1

  @AC-005
  Scenario: AC-005 schedule flake detection, collection, mutation, audit, contract drift, docs freshness, doc
    Given the nightly and e2e-reader workflows
    When they are read
    Then the nightly lists its jobs, e2e-reader runs only when enabled and says why it is disabled, and Stryker uses the Vitest runner
