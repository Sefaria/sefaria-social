Feature: Identity token verification and protect-by-default API

  @AC-001
  Scenario: A valid Sefaria token identifies the caller
    Given a token signed by the test key in the local JWKS for user 4242 named "Test Learner"
    When the caller calls a protected route with it as a Bearer token
    Then the handler runs as user 4242 named "Test Learner"

  @AC-002
  Scenario Outline: Invalid tokens are refused before the handler runs
    Given a token that is <problem>
    When the caller calls a protected route with it
    Then the response is 401 with error code "<code>"

    Examples:
      | problem                          | code               |
      | absent                           | auth.missing_token |
      | not a JWT                        | auth.invalid_token |
      | expired                          | auth.invalid_token |
      | signed by a key not in the JWKS  | auth.invalid_token |
      | signed with HS256                | auth.invalid_token |
      | issued by another issuer         | auth.invalid_token |
      | for another audience             | auth.invalid_token |
      | for a non-numeric subject        | auth.invalid_token |

  @AC-003
  Scenario: An unreachable JWKS makes protected routes unavailable, not open
    Given the JWKS server does not answer
    When the caller calls a protected route with a token
    Then the response is 503 with error code "auth.unavailable" within about 3 seconds

  @AC-003
  Scenario: Keys are cached and refetched for an unknown kid
    Given the JWKS was fetched once
    When a second token with the same kid is verified
    Then the JWKS is not fetched again
    When a token with a new kid that the JWKS now publishes is verified
    Then the JWKS is fetched again and the token is accepted

  @AC-004
  Scenario: Every non-public API route refuses anonymous callers
    Given the list of routes the server serves under /api/
    When each route and method is called without credentials
    Then each answers 401, except GET /api/v1/health

  @AC-005
  Scenario: An endpoint cannot be public by accident
    Given an endpoint declared public whose method and path are not on the public list
    When it is defined
    Then defining it fails with an error naming the endpoint
