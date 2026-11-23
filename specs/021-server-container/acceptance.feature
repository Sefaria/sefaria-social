Feature: Server container — pinned, non-root image with a health check, and a standalone Helm values sketch

  @AC-001
  Scenario: AC-001 the Dockerfile passes the image rules
    Given the repository's Dockerfile
    When release check-dockerfile runs
    Then it passes

  @AC-001
  Scenario: AC-001 a Dockerfile that breaks a rule is refused
    Given Dockerfiles with an unpinned base, a fetched URL, no USER and no HEALTHCHECK
    When release check-dockerfile runs on each
    Then each is refused with the line and the fix

  @AC-002
  Scenario: AC-002 the image serves the API
    Given the built image and a migrated Postgres
    When the container runs
    Then health is 200, an unauthenticated rooms call is 401, Docker reports it healthy, its user is not root, and SIGTERM stops it within 10 seconds

  @AC-003
  Scenario: AC-003 the Helm values sketch
    Given deploy/helm/values.yaml and the server's configuration
    When the values are read
    Then they name a namespace, the image by digest, a non-root security context, probes on /api/v1/health, and every server variable from a ConfigMap or Secret with no secret value
