Feature: Release pipeline — immutable versioned assets, a stable manifest pointer, smoke tests and rollback

  @AC-001
  Scenario: AC-001 publish uploads a version immutably
    Given a surface build and an empty filesystem target
    When release publish runs twice, and then with a changed file under the same version
    Then every listed file and the manifest are under v/<version>/ with immutable headers and no source maps, the second run changes nothing, and the third is refused

  @AC-001
  Scenario: AC-001 publish refuses a build whose file does not match its hash
    Given a surface build with one chunk altered after the build
    When release publish runs
    Then it is refused naming the file, and nothing is uploaded

  @AC-002
  Scenario: AC-002 promote smoke-tests and moves the pointer
    Given two published versions
    When the first and then the second is promoted
    Then stable/manifest.json points into the second version's folder with a no-cache header, and the first is the last known-good

  @AC-002
  Scenario: AC-002 promote refuses a bad version
    Given a version that is not published, and a published version with an altered file
    When each is promoted
    Then both are refused and the pointer stays where it was

  @AC-003
  Scenario: AC-003 rollback moves the pointer back
    Given versions 1 and 2 promoted in order
    When scripts/rollback runs with no argument, and then promote 2 is tried
    Then the pointer is on version 1, version 2 is marked rolled back, and promoting it again is refused

  @AC-003
  Scenario: AC-003 rollback with nothing to go back to
    Given a single promoted version
    When scripts/rollback runs
    Then it is refused and the pointer is unchanged

  @AC-004
  Scenario: AC-004 storage target selection
    Given RELEASE_TARGET set to a folder, to a bucket, and unset
    When release status runs with each
    Then the folder works, the bucket is refused as a stub, and unset is refused with how to set it

  @AC-005
  Scenario: AC-005 the release workflow
    Given release.yml
    When it is read
    Then it runs on pushes to main and manually, never cancels a run, rehearses on a filesystem target, and each real upload, deploy, smoke and promote step is gated on its secret with a notice when absent

  @AC-006
  Scenario: AC-006 a local release and rollback, end to end
    Given a filesystem target served over HTTP on another origin
    When version 1 and version 2 are built, published and promoted, and then rolled back
    Then the harness loads version 2 through the stable manifest with integrity, then version 1 again, and an altered file stops the load
