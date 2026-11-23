Feature: The surface bundle is minified and held to a size budget in CI

  @AC-001
  Scenario: AC-001 the surface build is minified
    Given the surface build configuration
    When the surface is built
    Then no line of the entry is indented, no pure annotation remains, and the manifest still hashes every file

  @AC-002
  Scenario: AC-002 a build within budget passes
    Given a surface build smaller than every budget
    When surface:budget runs
    Then it prints each file with raw and gzip sizes, the totals against their limits, and exits 0

  @AC-003
  Scenario: AC-003 a build over budget fails with the fix
    Given a surface build whose entry is larger than the entry budget, and a build missing a listed file
    When surface:budget runs on each
    Then it exits non-zero naming the budget, the size, the limit and the fix, or the missing file

  @AC-004
  Scenario: AC-004 CI runs the budget check
    Given ci.yml
    When its build job is read
    Then the budget check runs right after the surface build
