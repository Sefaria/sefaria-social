---
id: "031"
title: For you — the timeline ranked the way X ranks its home timeline
status: proposed
features: [FEED-072, FEED-073]
owner: "@Sefaria/sefaria-social-owners"
surfaces: [feed, post]
risk: normal
contract_impact: none
---

## Problem

Everyone is newest first: a quiet post from a minute ago sits above the morning's shiur announcement that thirty people
answered, and one prolific account fills the page. X open-sourced how its "For you" timeline is ranked
(github.com/twitter/the-algorithm, the-algorithm-ml); we rank ours the same way, scaled to a small community, and order the
conversation under a post the way X does.

## Acceptance criteria

- AC-001 WHEN the viewer opens the second tab (labelled "For you", API `tab=everyone`) THE SYSTEM SHALL rank every post from the
  last 14 days (at most 500) for that viewer with X's heavy-ranker sum, score = Σ weight(a) × P(a), using X's published weights
  (fav 0.5, repost 1.0, reply 13.5, reply engaged by author 75, negative feedback −74, report −369) and a quote weight of 12.5;
  P(a) is the post's own engagement per follower of its author, smoothed toward a prior, and lifted by the viewer's own recent
  engagement with that author. The score halves every 24 hours from the post's latest boost (posted, reposted or quoted). A post
  from outside the viewer's network is × 0.75 (X's OONTweetScalingScorer) unless a profile the viewer follows reposted it, in
  which case it says who.
- AC-002 THE SYSTEM SHALL spread authors out: after scoring, each further post by the same author in the ranking is × 0.5, down
  to × 0.25 (X's author-diversity rescoring). Pages are 20 with a cursor that keeps the ranking's time, so "Show more" never
  repeats a post.
- AC-003 WHEN a post's page is read THE SYSTEM SHALL order its replies: the post's author's own first, then replies from profiles
  the viewer follows, then the rest, oldest first within each.
- AC-004 The ranking SHALL be one pure module (services/ranking.ts) whose constants name their source (X's code or our choice),
  tested on its own.

## Out of scope

- A trained model, impressions, dwell time, "show less often", mute and report (the weights exist; nothing records them yet).
- Following stays chronological, as on X.

## Notes for the planner

- Candidates and features in one SQL query (services/posts.ts `rankCandidates`); scoring and rescoring in `ranking.ts`.
- The tab keeps its API value `everyone` (no breaking change); only its label changes.
