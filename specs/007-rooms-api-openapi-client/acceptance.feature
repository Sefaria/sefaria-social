Feature: Rooms API with ownership checks, OpenAPI document and generated client

  @AC-001
  Scenario: A signed-in user creates a room and owns it
    Given a signed-in user 4242 named "Test Learner"
    When they POST /api/v1/rooms with title "  Daf Yomi  "
    Then the response is 201 with a room titled "Daf Yomi", owner 4242 and role "owner"
    And the display cache holds the name "Test Learner" for user 4242

  @AC-002
  Scenario: A user lists only their rooms, newest first
    Given user 4242 owns rooms "First" and then "Second"
    And user 5151 owns room "Other"
    When user 4242 calls GET /api/v1/rooms
    Then the response lists "Second" then "First" and not "Other"

  @AC-003
  Scenario: A non-member cannot see, rename or delete a room
    Given user 5151 owns a room
    When user 4242 calls GET, PATCH and DELETE on that room
    Then each response is 404 with "room.not_found"
    And a room id that does not exist gets the same answer
    And the room is unchanged

  @AC-004
  Scenario: Only the owner can rename or delete
    Given user 5151 owns a room and user 4242 is a member
    When user 4242 renames or deletes it
    Then the response is 403 with "room.forbidden" and the room is unchanged
    When user 5151 renames it to "Renamed"
    Then the response is 200 with the title "Renamed"
    When user 5151 deletes it
    Then the response is 204 and the room and its memberships are gone

  @AC-005
  Scenario: Invalid input is refused
    When a signed-in user posts a room with an empty title, or calls a room path with an id that is not a UUID
    Then the response is 400 with "request.invalid" and nothing changes

  @AC-006
  Scenario: The OpenAPI document and client types match the schemas
    Given the endpoint contracts
    When the OpenAPI document and the client types are generated
    Then they equal the committed packages/api-client/openapi.json and packages/api-client/src/schema.ts

  @AC-007
  Scenario: A breaking API change is refused
    Given the base document has GET /api/v1/rooms returning rooms with a "title"
    When the PR's document removes "title" from the response
    Then the breaking-change check fails and names the removed property

  @AC-007
  Scenario: A breaking change declared api-major passes
    Given the same breaking change
    And a spec changed in the PR declares contract_impact api-major
    When the breaking-change check runs
    Then it passes with a notice
