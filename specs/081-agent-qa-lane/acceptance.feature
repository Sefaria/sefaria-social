Feature: Agent QA tests the surfaces a pull request touches and reports one recount

  @AC-001
  Scenario: AC-001 map them to surfaces through factory/surface-map.yaml, mapping shared code to every surfac
    Given a feature file, a shared lib file and a doc changed
    When the surfaces are derived
    Then the feature's surface and every importer's surface are listed, and the doc is ignored

  @AC-002
  Scenario: AC-002 fail the derivation, naming the file and how to add it to the map
    Given a product file outside every surface changed
    When the surfaces are derived
    Then it fails and names the file and the fix

  @AC-003
  Scenario: AC-003 fail factory doctor with rule surface-map
    Given a spec naming a surface the map lacks
    When factory doctor runs
    Then it reports the spec and the surface

  @AC-004
  Scenario: AC-004 report a retry after a failure as failed-then-recovered, a surface that could not be reach
    Given evidence with a pass, a retry, an unreachable surface and a pass without evidence
    When the recount runs
    Then it counts 1 pass, 1 failed-then-recovered, 1 cannot-reach, 1 fail and exits 1

  @AC-005
  Scenario: AC-005 block the report or report the mismatch
    Given a derived surface with no journey and a runner claiming more passes than it has
    When the recount runs
    Then the report is BLOCKED and names the surface and the mismatch

  @AC-006
  Scenario: AC-006 produce one evidence comment and one issue body per failure with its transcript, and, when
    Given evidence with one failure
    When the recount renders
    Then there is one comment and one issue file
    And a run with no evidence yields cannot-reach for each surface

  @AC-007
  Scenario: AC-007 build the environment in the job with a Postgres service, run the planner, the runner and 
    Given the agent-qa workflow
    When its qa job is read
    Then it has a Postgres 15 service, three separate agent steps and one comment step
