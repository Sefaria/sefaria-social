Feature: Social context in the reader's ctx parameter

  @AC-001
  Scenario: Encode and decode a room context
    When social encodes the room "room-00001"
    Then the value is "social.room.room-00001"
    And decoding it gives the room "room-00001"

  @AC-002
  Scenario: Foreign or malformed values are no context
    When social decodes "other.room.room-00001" or "social.room.short"
    Then there is no context

  @AC-003
  Scenario: Only ctx changes on a reader URL
    Given the reader URL "/Genesis.1.3?lang=bi&with=Commentary+ConnectionsList#seg"
    When social adds the room "room-00001"
    Then the URL is "/Genesis.1.3?lang=bi&with=Commentary+ConnectionsList&ctx=social.room.room-00001#seg"
    And removing it gives the original URL back
