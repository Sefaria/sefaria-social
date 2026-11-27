---
id: "060"
title: Social wears the Sefaria Labs brand — a visual preview
features: [FEED-077]
status: approved
owner: "@Sefaria/sefaria-social-owners"
surfaces: [feed, post, profile, room-lobby, rooms, settings]
risk: normal
contract_impact: none
---

## Problem

Sefaria Social is the flagship of Sefaria Labs, and Labs now has a brand: Sefaria's tokens with a Labs take. Labs itself (its
channels, anything AI) looks like a workshop at night: deep blue, a mono type, a violet for the machine. Social's mood is
different: **joy, curiosity, discovery, connection**. So Social takes the Labs family's daylight side: white paper, sunny
gold, a colour for every learner, small moments of delight. Social today looks like the reader with no voice of its own. The
owners want to see social's pages in this brand before deciding whether, and how, to ship it. The brand is recorded in the
Sefaria Labs design system (https://claude.ai/artifact/Kvv5SDmwdyhoy8VpevxSKD), section "Sefaria Social: Daylight".

This spec is a preview: it changes how social looks and nothing it does.

## Acceptance criteria

- AC-001 WHEN social renders under the reader's light or sepia theme THE SYSTEM SHALL paint its frame in the Daylight palette
  (page #FFFFFF, white paper after the first review, ink #1B2233, brand #1E3F73, highlight #F6E7B8), and under the dark theme in Night (page #0B1426, ink #F2EDE3,
  brand #8FB0E8), by re-mapping the reader's `--sefaria-*` tokens inside social's root only; the reader's own page is unchanged,
  every text colour SHALL keep at least 4.5:1 contrast on its page in both palettes, and page headings SHALL be set in the serif
  text face
- AC-002 WHEN the frame renders THE SYSTEM SHALL show the Sefaria Social mark (a page with two cursors, teal and gold;
  decorative, hidden from assistive technology) beside the nav and the words "from Sefaria Labs" in the interface language
  (Hebrew with `lang` and `dir`)
- AC-003 THE SYSTEM SHALL speak in three type voices: what the system says (nav and tabs, section labels, refs, times, counts,
  status labels such as LIVE, buttons) in the Labs mono, in capitals with tracking; what people wrote (posts, room names, names,
  the composer) in the serif text face; the interface sans only for small helper text
- AC-004 THE SYSTEM SHALL use the Labs teal only for what is live now (a live card's dot, LIVE label and cursor bar at its
  reading-start edge), the gold for warmth and action (highlights, the unread count, the active tab, a given Yasher koach, and the
  primary button, a gold pill), and the violet only for what a model wrote; apart from the mark's two cursors, teal and violet
  appear nowhere else. A room that is not live is drawn quietly (no fill, muted name)
- AC-005 WHEN an avatar is drawn THE SYSTEM SHALL draw it as presence: white with a ring in the person's cursor colour and the
  initials in ink, the colour taken from the Labs cursor set (gold, blue, sky, coral, moss, rose; never teal or violet, which are
  signals), the same colour for the same person every time, each ring at 3:1 or more on white and the initials at 4.5:1 or more
- AC-006 WHEN a post's text ends with a question mark THE SYSTEM SHALL mark it with a "Question" label (Hebrew "שאלה") beside the
  time, so questions stand out in the feed
- AC-007 WHEN a live dot is shown THE SYSTEM SHALL pulse it slowly, and WHEN a learner gives Yasher koach the icon SHALL turn gold
  with a short pop; with reduced motion asked for, nothing moves

## Out of scope

- Changing the reader's tokens or themes, or the host contract. Behaviour of any page beyond the question label. New flows.
- A celebration on a siyum, and colour-coded "For you" cards: both need data social does not have yet (a siyum event; a ref's
  category). Follow-ups.
- The final decision to ship: this is a preview behind no flag. A shipping spec would add an opt-in and visual tests in English,
  Hebrew and dark (plan 4.7).

## Notes for the planner

- One CSS module, `app/src/ui/brand.module.css`, holds the palette once (the only place with literal colours besides the avatar
  tones) and maps it onto `--sefaria-*` with `light-dark()`; `SocialLayout` adds its class to `.frame`. JetBrains Mono ships with
  the surface (OFL) as `@font-face` in that module.
- `isQuestion(text)` in `features/post/question.ts`, pure, unit-tested; `PostCard` renders the label.
