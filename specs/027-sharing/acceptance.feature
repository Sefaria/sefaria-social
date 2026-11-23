Feature: Sharing

  @AC-001
  Scenario: AC-001 the share menu and the link it shares
    Given a post in the timeline
    When the learner presses Share
    Then the menu offers Copy link, WhatsApp and Email, and the link is the absolute address of the post's page

  @AC-002
  Scenario: AC-002 each way to share
    Given the share menu of a post
    When the learner copies the link, then opens WhatsApp, then closes the menu with Escape
    Then the clipboard holds the link and Link copied is announced, WhatsApp opens wa.me with the opening words and the link, and focus returns to Share
