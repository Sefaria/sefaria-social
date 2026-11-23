Feature: Database, migrations, health check and request logging

  @AC-001
  Scenario: Migrations create the first tables with timezone timestamps and indexed foreign keys
    Given an empty Postgres database
    When the migrations run
    Then the tables rooms, room_members, shiurim, shiur_recordings, user_display, deleted_users and webhook_receipts exist
    And no column is a timestamp without time zone
    And every foreign key has an index starting with its columns

  @AC-002
  Scenario: A destructive migration without a contract note is refused
    Given a migration that drops a column and has no "-- contract:" line
    When the migration check runs
    Then it fails and names the file and the statement

  @AC-002
  Scenario: A destructive migration with a contract note is allowed
    Given a migration that drops a column and has the line "-- contract: column unused since the previous release"
    When the migration check runs
    Then it passes

  @AC-003
  Scenario: Health is public and reports the database
    Given the database is reachable
    When anyone calls GET /api/v1/health without a token
    Then the response is 200 with {"status":"ok","database":"ok"}

  @AC-004
  Scenario: Health reports an unreachable database
    Given the database does not answer
    When the health check runs
    Then the response is 503 with {"status":"unavailable","database":"unavailable"} within about 2 seconds

  @AC-005
  Scenario: One structured log line per request, without secrets
    Given a request with an Authorization header and a JSON body
    When the request completes
    Then exactly one log line is written for it
    And it has a static message, the method, the route template, the status, the duration and the correlation id
    And it contains neither the token, nor any header, nor the body

  @AC-006
  Scenario: A valid correlation id is propagated
    Given a request with X-Correlation-Id "surface-1234.abcd"
    When the request completes
    Then the response header X-Correlation-Id is "surface-1234.abcd"
    And the log line carries "surface-1234.abcd"

  @AC-006
  Scenario: An invalid correlation id is replaced
    Given a request with X-Correlation-Id "bad id with spaces"
    When the request completes
    Then the response header X-Correlation-Id is a newly generated id
