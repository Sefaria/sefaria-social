Feature: Test-only persona sessions and idempotent QA seed and reset

  @AC-001
  Scenario: AC-001 return that persona's bearer token and a one-time harness sign-in URL, and GET /api/v1/me 
    Given the server runs with SOCIAL_ENV=test-ci and a persona secret
    When a client posts persona learner with the secret
    Then it receives a token
    And GET /api/v1/me with that token returns the learner's id

  @AC-002
  Scenario: AC-002 return 403 and create no session
    Given the server runs with SOCIAL_ENV=production and a secret configured
    When a client posts a persona with the right secret
    Then it receives 403 and no session exists

  @AC-003
  Scenario: AC-003 contain no route handler that issues persona sessions, proven by a test that enumerates th
    Given the production route table
    When a test enumerates it
    Then no persona route is reachable

  @AC-004
  Scenario: AC-004 create nothing the second time
    Given an empty test database
    When qa:seed runs twice for one scenario
    Then the row counts after the second run equal those after the first

  @AC-005
  Scenario: AC-005 leave zero rows in every table of the schema, checked against the schema itself
    Given a seeded test database
    When qa:reset runs
    Then every table listed by the schema has zero rows
