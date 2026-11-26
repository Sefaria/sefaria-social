Feature: A token issued through the MCP saves Claude assets and is refused everywhere else, the relay included

  @AC-001
  Scenario: AC-001 the two asset write routes accept a marked token
    Given a valid token for user U with via "mcp"
    When it saves an asset, and when it imports one
    Then each answers as for U (201, or 422 with problems), and the asset's owner is U

  @AC-002
  Scenario: AC-002 every other route refuses a marked token
    Given a valid token for user U with via "mcp"
    When it calls GET /api/v1/profiles/me, POST /api/v1/posts, GET /api/v1/claude-assets and DELETE /api/v1/claude-assets/<id>
    Then each answers 403 with error code "auth.mcp_not_allowed" and nothing changed
    When it calls every method of every route the server serves that needs a user
    Then exactly POST /api/v1/claude-assets and POST /api/v1/claude-assets/import do not answer 403 "auth.mcp_not_allowed"

  @AC-003
  Scenario: AC-003 any other via value is an invalid token
    Given a valid token for user U with via "other"
    When it calls GET /api/v1/profiles/me or POST /api/v1/claude-assets
    Then each answers 401 with error code "auth.invalid_token"

  @AC-004
  Scenario: AC-004 the relay refuses a marked token
    When a socket offers the relay a token with via "mcp"
    Then the relay answers 401
    And the same token without the via claim is accepted

  @AC-005
  Scenario: AC-005 the list of routes that take a marked token is reviewed
    When an endpoint not on MCP_ENDPOINTS is declared with mcp true
    Then declaring it throws with a message that names MCP_ENDPOINTS
