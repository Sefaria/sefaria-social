Feature: Serve a Claude asset's file sandboxed from its own origin, its network closed or open by a context the server decides

  Background:
    Given SOCIAL_ALLOWED_ORIGINS is "https://www.sefaria.org,https://sefaria.org.il"
    And a user's saved asset A with version V

  @AC-001
  Scenario: AC-001 the public URL is sandboxed and closed
    When anyone asks for the public content URL of V
    Then the answer is 200 with the stored bytes and content type "text/html; charset=utf-8"
    And X-Content-Type-Options is "nosniff" and Referrer-Policy is "no-referrer"
    And the Content-Security-Policy starts with "sandbox allow-scripts"
    And its frame-ancestors are exactly "https://www.sefaria.org https://sefaria.org.il"
    And it has default-src 'none', script-src and style-src 'unsafe-inline', img-src data: blob:, and no connect-src

  @AC-002
  Scenario: AC-002 the trusted CDN list is a switch
    Given ASSET_TRUSTED_CDNS_ENABLED is unset
    Then the public policy names no CDN host
    When ASSET_TRUSTED_CDNS_ENABLED is "true"
    Then script-src, style-src and font-src each list "https://cdnjs.cloudflare.com" and the other default hosts

  @AC-003
  Scenario: AC-003 the shiur URL is signed, short-lived and open
    Given V is pinned in shiur S
    When the shiur's URL for V is asked for
    Then the answer is the same bytes with a policy that starts with "sandbox allow-scripts", has the same frame-ancestors and allows every source
    When the grant's signature is changed, it is used for another version, it has expired, or S no longer pins V
    Then each answers 404

  @AC-004
  Scenario: AC-004 content lives on its own origin
    Given ASSET_CONTENT_ORIGIN is "https://assets.example.test"
    When V's public content URL is asked for on the API's own origin
    Then the answer is 404
    And every contentUrl the API answers starts with "https://assets.example.test/"

  @AC-005
  Scenario: AC-005 taken down, deleted or unknown, and caching
    Then the public URL is cacheable with "public, max-age=300" and the shiur URL is "private"
    When A is hidden, or deleted, or an unknown version id is asked for
    Then the public and the shiur URLs answer 404

  @AC-006
  Scenario: AC-006 the API gives each version its content URL
    When anyone asks for asset A, and when the owner saves a new version
    Then each version in the answer has a contentUrl ending in "/api/v1/claude-assets/content/<version id>"
