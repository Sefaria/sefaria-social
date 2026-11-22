Feature: Social page shows the surface name and contract version

  @AC-001
  Scenario: The placeholder page names the surface and its contract version
    Given the social app is running
    When anyone opens "/social"
    Then the page shows the heading "Sefaria Social"
    And the page shows "Surface: social, SurfaceHost contract v1.0"
