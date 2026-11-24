Feature: A room member can get a LiveKit token to join the room's call

  @AC-001 @AC-002
  Scenario: AC-001 AC-002 a member gets a token for this room with the member grants
    Given calls are available and Dana is a member of room R
    When Dana requests a call token for room R
    Then the answer is 200 with the LiveKit url, a token and its expiry 10 minutes ahead
    And the token names room "room_R", identity "u:<Dana's id>", Dana's display name and role "member"
    And it grants joining room R only, subscribing, publishing microphone, camera and screen share, and no data publishing

  @AC-001
  Scenario: AC-001 the owner's token says owner
    Given calls are available and Avi owns room R
    When Avi requests a call token for room R
    Then the token's metadata role is "owner"

  @AC-003
  Scenario: AC-003 a non-member and a missing room look the same
    Given calls are available and Noa is not a member of room R
    When Noa requests a call token for room R, and then for a room that does not exist
    Then both answers are 404 with the same body and no token

  @AC-004
  Scenario: AC-004 no identity, no token
    When a request without a valid Django token asks for a call token
    Then the answer is 401

  @AC-005
  Scenario: AC-005 calls switched off
    Given CALLS_ENABLED is not "true"
    When Dana requests a call token for room R and reads room R
    Then the token request answers 503 with error code "call.unavailable" and the room says calls are not available

  @AC-006
  Scenario: AC-006 too many token requests
    Given calls are available and Dana is a member of room R
    When Dana requests 21 call tokens for room R within a minute
    Then the 21st answer is 429 with error code "request.rate_limited" and a retry-after header

  @AC-007
  Scenario: AC-007 secrets never reach the log
    Given the server log is captured
    When a token is issued and a token request is refused
    Then the log contains neither the token, the API key, the API secret nor the Django token

  @AC-008
  Scenario: AC-008 the API document and client carry the endpoint
    When the OpenAPI document and client are generated
    Then they include the call token endpoint and the room's calls field, and the breaking-change check passes
