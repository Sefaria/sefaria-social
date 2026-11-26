Feature: Save a Claude asset by file or URL, its manifest and refs checked, as immutable versions in the object store

  Background:
    Given Sefaria knows "Genesis 1:1-5" (segments Genesis 1:1 to 1:5, section Genesis 1) and "Genesis 1:6-8"
    And Sefaria does not know "Genesis 99:1"

  @AC-001
  Scenario: AC-001 a valid file becomes an asset with version 1
    When a signed-in user posts an HTML file whose manifest declares "Genesis 1:1-5" labelled "Day one" and "Genesis 1:6-8"
    Then the answer is 201 with the asset's title and description from the manifest, version 1 and created true
    And the version's manifest lists each ref with its normal form, Hebrew form, section refs and segment refs
    And the object store holds the file's exact bytes under "assets/<asset id>/<sha256>.html"
    And a title sent beside the file is ignored

  @AC-002
  Scenario: AC-002 new versions belong to the owner, and the same bytes are not stored twice
    Given the user has an asset A with version 1
    When the user posts a changed file with assetId A
    Then the answer is 201 with version 2, which is now current
    When the user posts the same changed file again with assetId A, and again without an assetId
    Then each answers 200 with version 2 and unchanged true, and no version 3 exists
    When another user posts a file with assetId A, or anyone posts with an unknown assetId
    Then each answers 404 and nothing is stored

  @AC-003
  Scenario Outline: AC-003 a file that cannot be saved is refused with problems a model can act on
    When the user posts <file>
    Then the answer is 422 with error code "asset.invalid" and a problem with code "<code>"
    And the problem's message says what to change
    And no asset, version or file was stored

    Examples:
      | file                                                    | code              |
      | a file larger than ASSET_MAX_BYTES                      | size.too_large    |
      | a file with no sefaria-asset manifest block             | manifest.missing  |
      | a file with two sefaria-asset manifest blocks           | manifest.multiple |
      | a manifest block that is not JSON                       | manifest.json     |
      | a manifest with "v": 2                                  | manifest.version  |
      | a manifest with no title                                | manifest.invalid  |
      | a manifest with an empty refs list                      | refs.missing      |
      | a manifest declaring "Genesis 99:1" (the problem names it) | ref.invalid    |

  @AC-004
  Scenario: AC-004 a dry run checks without storing or counting
    When the user posts a valid file with dryRun true
    Then the answer is 200 with dryRun true, the normalized manifest, the size and the hash
    And no asset was created and the daily count is unchanged
    When the user posts an invalid file with dryRun true
    Then the answer is 422 with its problems

  @AC-005
  Scenario: AC-005 the daily limit
    Given ASSET_DAILY_LIMIT is 2 and the user saved 2 new versions in the last 24 hours
    When the user posts another new file
    Then the answer is 429 with error code "asset.daily_limit" and nothing is stored
    And another user can still save

  @AC-006
  Scenario: AC-006 Sefaria cannot be asked
    Given Sefaria answers 500, or answers with a body that is not the expand schema
    When the user posts a valid file
    Then the answer is 503 with error code "asset.refs_unavailable" and nothing is stored

  @AC-007
  Scenario: AC-007 import from a URL, with its refusals
    Given a public HTTPS page that answers a valid asset file as text/html
    When the user posts its URL to the import route
    Then the answer is 201 and the asset's sourceUrl is that URL
    When the user imports "http://example.org/a.html", "https://claude.ai/public/artifacts/x", "https://x.claudeusercontent.com/a"
    Then the answers are 422 with "import.https_only", "import.claude_link" and "import.claude_link"
    And the claude_link message names the Sefaria connector ("save this to Sefaria") and uploading the downloaded file
    When the host resolves to 127.0.0.1, 10.0.0.1, 169.254.169.254, ::1, fd00::1 or ::ffff:192.168.0.1
    Then the answer is 422 with "import.address_refused" and nothing was fetched
    When the page answers a redirect, a non-HTML type, or a body larger than the limit
    Then the answers are 422 with "import.redirect", "import.not_html" and "size.too_large"
    And the connection went to the address that was checked, not to a second DNS answer

  @AC-008
  Scenario: AC-008 reading an asset, and listing one's own
    Given the user's asset A with two versions
    When anyone, signed out included, asks for asset A
    Then the answer is 200 with title, description, author name, profile id and verified false, sourceUrl, both versions and the current manifest
    And the answer holds no Sefaria user id
    When staff hide asset A
    Then asking for it answers 404, and the owner's list shows it with hidden true

  @AC-009
  Scenario: AC-009 deleting an asset, or its owner
    When another user deletes asset A
    Then the answer is 404 and A is unchanged
    When the owner deletes asset A
    Then the answer is 204, A and its versions are gone and nothing is left under "assets/<A>/"
    When the owner of asset B is deleted by Sefaria's webhook
    Then B, its versions and its files are gone
