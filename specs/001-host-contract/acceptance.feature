Feature: Pinned SurfaceHost contract, runtime schemas and the fake host

  @AC-001
  Scenario: Values from the host are validated against the pinned contract
    Given the pinned SurfaceHost v1 contract
    When a reader snapshot carrying "ctx=social.room.abcdefgh" in its url arrives
    Then the snapshot schema refuses it
    And a host whose contract major is 2 is refused by the host shape schema

  @AC-002
  Scenario: The fake host behaves like the reader
    Given a fake host at "/social"
    When the surface navigates to "/social/r/abcdefgh" and then the user goes back
    Then the fake host's address is "/social"
    And navigating to "https://evil.example/" is refused and reported as "navigate-refused"

  @AC-003
  Scenario: A hand edit of the pinned contract fails the pin check
    Given the pinned contract files and their recorded hashes
    When "pinned/surface-host.v1.ts" is edited by hand
    Then the pinned-contract check fails and names "pinned/surface-host.v1.ts"

  @AC-004
  Scenario: A renamed contract member stops the fake host compiling
    Given the pinned contract renames "requestSignIn" to "requestLogin"
    When the host-contract package is type-checked
    Then the fake host fails to compile
