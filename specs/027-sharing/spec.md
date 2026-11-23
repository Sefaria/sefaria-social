---
id: "027"
title: Sharing — send a post or a profile anywhere, with a link that opens it
status: proposed
features: [FEED-068]
owner: "@Sefaria/sefaria-social-owners"
surfaces: [feed, post, profile]
risk: normal
contract_impact: none
---

## Problem

Agreed on 23 Nov: Labs assets must travel outside Sefaria with a share button (copy link, WhatsApp, and more). Most Torah is
shared in WhatsApp groups; a post that cannot leave the feed cannot bring anyone back to it. A shared link must open the post
itself, never the home page.

## Acceptance criteria

- AC-001 WHEN a viewer presses "Share" on a post (in the timeline or on its page) or on a profile THE SYSTEM SHALL offer, in a
  small menu, "Copy link", "WhatsApp" and "Email", and "Share…" when the browser offers the Web Share API; the link is the
  absolute address of `/social/p/$postId` (or `/social/u/$profileId`) on the reader's site, built with `host.href` (R15).
- AC-002 WHEN the viewer chooses "Copy link" THE SYSTEM SHALL put the link on the clipboard and say "Link copied" in a polite
  live region; "WhatsApp" opens `https://wa.me/?text=` with the post's opening words and the link; "Email" opens a `mailto:` with a
  subject and the link; the menu closes with Escape or a click outside and returns focus to the Share button.

## Out of scope

- Embeds for other websites, link previews (Open Graph) for social pages, sharing rooms and shiurim.
