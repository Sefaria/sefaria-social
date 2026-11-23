Feature: The social surface in a fake reader page, with the routes of R6

  @AC-001
  Scenario: The surface build is loadable by the reader
    When the surface is built
    Then the output has one entry module, its chunks, one CSS file and a manifest.json
    And the reader's manifest schema accepts the manifest and every listed file matches its sha384 hash

  @AC-002
  Scenario: Navigation goes through the host and Back comes from the reader
    Given the surface is mounted on "/social/r/room-00001"
    When the user follows the "Settings" link
    Then the host was asked to push "/social/settings"
    And when the reader goes back the room page shows again without another navigation

  @AC-003
  Scenario: Deep links and social's not-found page
    When the surface is mounted on "/social/s/Shiur_Abc-123"
    Then the shiur page shows
    And when it is mounted on "/social/r/short" social's not-found page shows

  @AC-004
  Scenario: Search parameters are validated per route
    When the surface is mounted on "/social/settings?tab=notifications&foo=bar"
    Then the notifications tab shows
    And the Profile tab link's href is "/social/settings?tab=profile"

  @AC-005
  Scenario: Social never touches the browser history
    Given the surface is mounted on "/social"
    When the user follows two links
    Then window.history.length and window.location are unchanged

  @AC-006
  Scenario: Links are real hrefs handed to the host
    Given the surface is mounted on "/social/s/shiur-0001"
    When the user follows "Open Genesis 1 in the reader"
    Then the reader's commands were asked to go to "Genesis 1"

  @AC-007
  Scenario: The persistent mount renders only inside a social context
    Given the reader is on "/Genesis.1" with no social ctx
    Then the persistent mount is empty
    And when the reader moves to "/Genesis.2?ctx=social.room.room-00001" it shows a link to "/social/r/room-00001"

  @AC-008
  Scenario: Both route trees own only /social
    When the Start route tree and the surface route tree are listed
    Then both list "/social", "/social/$", "/social/r/$roomId", "/social/s/$shiurId" and "/social/settings"

  @AC-009
  Scenario: Standalone mode uses the browser history
    Given the browser is at "/social/settings?tab=notifications"
    When the Start app's router loads
    Then it matches "/social/settings" with search tab "notifications"

  @AC-010
  Scenario: A host from another major gets the reload notice
    When the surface is mounted with a host whose contract major is 2
    Then a "please reload" notice shows and "contract-mismatch" is reported

  @AC-011
  Scenario Outline: The harness journeys on <viewport> in <language>
    Given the harness page in the <language> interface on a <viewport> viewport
    When every R6 page is opened from a deep link and the user moves Back and Forward
    Then each page shows with the interface language's lang and dir

    Examples:
      | viewport | language |
      | desktop  | English  |
      | desktop  | Hebrew   |
      | phone    | English  |
      | phone    | Hebrew   |

  @AC-012
  Scenario: The room lobby names its room
    When the surface is mounted on "/social/r/room-00001"
    Then the room lobby shows "Room id: room-00001"

  @AC-013
  Scenario: The shiur page names its shiur
    When the surface is mounted on "/social/s/shiur-0001"
    Then the shiur page shows "Shiur id: shiur-0001"
