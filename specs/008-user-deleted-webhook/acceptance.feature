Feature: Account deletion in Sefaria removes the user's social data

  @AC-001
  Scenario Outline: A webhook without a valid signature is refused
    Given a user.deleted event for user 900000001
    When it is posted <signature>
    Then the response is 401 with "webhook.bad_signature"
    And no data changed

    Examples:
      | signature                                     |
      | with no X-Sefaria-Signature header            |
      | with a signature made with another secret     |
      | with a valid signature over a different body  |

  @AC-001
  Scenario: The Django test vector verifies
    Given the secret "secret" and the body from the Django contract
    Then the computed signature is "sha256=5a26b7ac2ff4e75aeec9a4dfa56aab52601ce60bb5435b0b44ac82515678a165"

  @AC-002
  Scenario: A signed deletion removes the user's rows from every table
    Given every table holds rows for user 900000001 and for user 900000002
    When a correctly signed user.deleted event for user 900000001 is posted
    Then the response is 200 with {"status":"processed"}
    And walking every column of every table finds user 900000001 only in the tombstone
    And the rows of user 900000002 remain

  @AC-003
  Scenario: A redelivered event changes nothing
    Given the event was processed
    When the same event is posted again
    Then the response is 200 with {"status":"duplicate"}
    And no data changed

  @AC-004
  Scenario: A deleted user's still-valid token is refused
    Given user 900000001 has a tombstone
    When they call GET /api/v1/rooms with an otherwise valid token
    Then the response is 401 with "auth.user_deleted"

  @AC-005
  Scenario: Staff purge a user whose webhook was lost
    Given every table holds rows for user 900000001
    When staff run the purge-user command for 900000001
    Then walking the schema finds user 900000001 only in the tombstone
    And the command printed the rows removed per table

  @AC-006
  Scenario: A signed event of an unknown type is acknowledged and ignored
    When a correctly signed event of type "user.renamed" is posted
    Then the response is 200 with {"status":"ignored"}
    And no user data changed
