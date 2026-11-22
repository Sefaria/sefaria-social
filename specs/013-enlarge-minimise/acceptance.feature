Feature: Enlarge into a room's reader context and minimise out of it (R8–R14)

  @AC-001
  Scenario: Enlarging from the lobby onto the leader's place
    Given a member on the lobby while the leader is at "/Genesis.3"
    When they press Enter
    Then the host was told to push "/Genesis.3?ctx=social.room.<id>"
    And after the context is ready the leader's snapshot is applied with origin "follow"
    And no own place is kept, because the lobby is not a reader page

  @AC-002
  Scenario: Streamed moves replace, and Back leaves
    Given a follower in the room's context after one enlarge
    When the leader moves three times
    Then the follower's history grew by exactly one entry
    When the follower goes Back
    Then they are on the lobby without ctx and the session is idle

  @AC-003
  Scenario: Minimising returns to the viewer's own place
    Given a viewer who enlarged from "/Exodus.2"
    When they minimise
    Then the host was told to push "/Exodus.2"
    And the persistent mount shows the room with Enlarge and Leave

  @AC-004
  Scenario: A cold load of a ctx address reconnects
    Given a fresh surface on "/Genesis.3?ctx=social.room.<id>"
    Then the persistent mount connects to the room and the session is expanded

  @AC-005
  Scenario: Personal slices from others are never applied
    Given the follower's reader has "sefaria.settings" as personal and "sefaria.scroll" as moment
    When a snapshot with both arrives
    Then only "sefaria.scroll" is applied

  @AC-006
  Scenario: Outgoing snapshots carry nothing personal and no ctx
    Given a snapshot whose url has ctx=social.room.<id> and which holds "sefaria.settings"
    When it is published
    Then its url has no ctx, it has no "sefaria.settings", and it has "social.summary"
