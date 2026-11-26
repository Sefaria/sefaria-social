Feature: A shiur holds recordings and pinned Claude assets; assets on profiles and as post cards

  Background:
    Given user U owns a ready recording R and asset A (versions 1 and 2), and user V owns asset B, published, and asset C, not published

  @AC-001
  Scenario: AC-001 creating a shiur
    When U creates a shiur "Bereshit" with recording R
    Then the answer is 201 with visibility "unlisted" and R among its recordings, and U's shiur list has it
    When U creates a shiur with V's recording
    Then the answer is 404 and no shiur was created

  @AC-002
  Scenario: AC-002 reading a shiur
    Given U's unlisted shiur S with R and A pinned at version 1
    When anyone, signed out included, asks for S
    Then the answer has its title, visibility, owner name and profile id, recording R, and A at version 1 with refs, first ref, contentUrl and shiurUrl
    When U's private shiur is asked for, or an unknown id
    Then each answers 404

  @AC-003
  Scenario: AC-003 pinning, moving and removing
    Given U's shiur S
    When U pins A without a version
    Then A is pinned at its current version
    When U pins A at version 1
    Then A is pinned at version 1, once
    When U pins B
    Then B is pinned at its published version
    When U pins C, or B at a version that is not published, or an unknown asset
    Then each answers 404
    When V pins anything in S
    Then the answer is 404
    When U removes A from S
    Then S's assets are B only

  @AC-004
  Scenario: AC-004 the pin survives a newer version
    Given A is pinned in S at version 1
    When U saves version 3 of A
    Then S still answers A at version 1 with version 1's contentUrl

  @AC-005
  Scenario: AC-005 a profile's public assets
    When anyone asks for V's profile's assets
    Then the answer lists B with its title, description, refs, published version and contentUrl, and not C
    When B is hidden
    Then V's profile's assets are empty

  @AC-006
  Scenario: AC-006 an asset as a post card
    When V posts with embed asset B, and U posts with embed asset A (unpublished, U's own)
    Then each answers 201 with embed kind "asset", the asset's title, its author's name as leader and its contentUrl
    When U posts with embed asset C (V's, unpublished) or an unknown asset
    Then each answers 404 and no post was created

  @AC-007
  Scenario: AC-007 the interface
    Given V's profile page is shown to U
    Then it lists B with its description and an Open link to its contentUrl that opens in a new tab
    Given U's own profile page
    Then it lists U's assets with Publish, and a file input
    When U presses Publish and U is not verified
    Then it says publishing needs a verified profile
    When U uploads a file with a bad ref
    Then it shows the problem's message
    Given shiur S's page
    Then it lists its pinned assets with Open links
    Given a post with an asset embed
    Then its card shows the title, "by" the author and Open; for an asset that is gone it shows "no longer available"
