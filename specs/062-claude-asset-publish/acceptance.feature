Feature: Verified profiles publish Claude assets to the segments they cover, read by ref for the sidebar, with staff takedown

  Background:
    Given Sefaria knows "Genesis 1:1-5" and "Genesis 1:6-8"
    And user U's asset A declares "Genesis 1:1-5" labelled "Day one" and "Genesis 1:6-8"

  @AC-001
  Scenario: AC-001 staff verify a profile from the command line
    When staff run verify-profile for U's profile by its id with "--by staff-member"
    Then U's profile is verified with the time and "staff-member"
    And U's profile answers verified true
    When staff run verify-profile for "@unknown_handle"
    Then the command fails and no profile changed
    When staff run verify-profile for U's profile with "--off"
    Then U's profile answers with no verified field

  @AC-002
  Scenario: AC-002 only a verified owner publishes
    Given U's profile is not verified
    When U publishes A
    Then the answer is 403 with error code "asset.not_verified" and A has no published version
    Given U's profile is verified
    When U publishes A
    Then the answer is 200 with publishedVersionId the current version
    And there is one indexed row per segment Genesis 1:1 to 1:8, with section "Genesis 1" and the declared ref and label
    When another user publishes A, or U publishes A with a version of another asset
    Then each answers 404

  @AC-003
  Scenario: AC-003 unpublish, and a new version does not republish
    Given U published A's version 1
    When U saves version 2 of A
    Then A's published version is still version 1
    When U unpublishes A
    Then A has no published version and no indexed rows

  @AC-004
  Scenario: AC-004 the ref read API for the sidebar
    Given U is verified and published A
    When anyone asks for the assets on "Genesis 1"
    Then the answer has ref "Genesis 1" and A with its title, description, author name, profile id and verified true
    And A's anchorRefs are Genesis 1:1 to Genesis 1:8 in order, its refs are "Genesis 1:1-5" and "Genesis 1:6-8", with its versionId and contentUrl
    When anyone asks for the assets on "Genesis 1:7"
    Then A's anchorRefs are exactly "Genesis 1:7"
    When anyone asks for the assets on "Exodus 1" or on a ref nobody covers
    Then the answer has an empty assets list
    And the answer's cache-control is "public, max-age=60" and an allowed Origin gets access-control-allow-origin

  @AC-005
  Scenario: AC-005 staff take an asset down, and restore it
    Given U is verified and published A
    When staff run asset-takedown for A
    Then the ref answer for "Genesis 1" has no assets, asking for A answers 404 and its content answers 404
    And U's own list shows A hidden
    When staff run asset-takedown for A with "--restore"
    Then A is in the ref answer again

  @AC-006
  Scenario: AC-006 removing a verification hides at once
    Given U is verified and published A
    When staff remove U's verification
    Then the ref answer for "Genesis 1" has no assets and A is still published
    When staff verify U again
    Then A is in the ref answer again
