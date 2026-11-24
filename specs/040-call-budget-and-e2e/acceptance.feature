Feature: Calls are held to a size budget and tested end to end with fake cameras and a local LiveKit

  @AC-001
  Scenario: AC-001 the call chunk has its own budget and the entry barely grows
    Given a surface build with calls
    When the budget check runs
    Then the call chunk is measured against its own gzip limit
    And the entry chunk is no more than 4 kB gzip larger than before calls

  @AC-002
  Scenario: AC-002 the e2e stack has a LiveKit
    When the e2e stack starts
    Then a local LiveKit server runs beside the relay and the social server has calls enabled with its development key

  @AC-003
  Scenario: AC-003 fake cameras on desktop and phone
    When the call journeys run
    Then Chromium uses fake media devices with permission granted, on the desktop and the phone viewports

  @AC-004
  Scenario: AC-004 two browsers in one call
    Given browsers A and B are signed in as members of room R
    When both join room R's call with camera and microphone on
    Then B receives A's video and audio
    And when A mutes, B sees A muted
    And when A moves to another ref, A is still connected
    And when A leaves the call, B no longer sees A and A is still in room R

  @AC-005
  Scenario: AC-005 CI runs the call journeys
    When the e2e job runs in CI
    Then the call journeys run and a failing one fails the job
