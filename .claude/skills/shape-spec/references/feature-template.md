# acceptance.feature template

```gherkin
Feature: <spec title>

  @AC-001
  Scenario: <the AC in one line>
    Given <state>
    When <action>
    Then <observable result>
```

- One or more scenarios per AC; tag each with every AC it proves (`@AC-001 @AC-002`).
- A scenario with no `@AC-xxx` tag, or a tag the spec does not list, fails `factory compile`.
