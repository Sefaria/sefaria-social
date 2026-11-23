Feature: Coolify deployment — a shared dev backend and a full preview per pull request

  @AC-001
  Scenario: AC-001 the compose file defines the four services
    Given docker-compose.coolify.yml
    When it is read
    Then app is built from the Dockerfile and migrates before serving, postgres is pinned with a health check app waits for, and every secret is a variable reference

  @AC-002
  Scenario: AC-002 the surface image serves the release build
    Given deploy/coolify/surface.Dockerfile and its nginx configuration
    When they are read
    Then the release build is served with a no-cache manifest, immutable assets, any origin allowed, a non-root user, pinned bases and a health check on the manifest

  @AC-003
  Scenario: AC-003 the relay image runs the Worker from its environment
    Given deploy/coolify/relay.Dockerfile and its start script
    When they are read and the start script runs without its settings
    Then the Worker runs in workerd as a non-root user from pinned bases, takes its four settings from the environment, refuses to start without them, and checks /health
