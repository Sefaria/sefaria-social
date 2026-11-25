# Plan: 055 links in posts

Plan: `docs/plans/shiur.md` 4.7. Decision: `docs/decisions/0013-links-and-live-cards.md`.

## T-001 The embed on the API (AC-002, AC-003)

- Migration `0007_post_embeds.sql` (expand only): `posts.embed_kind text`, `posts.embed_id uuid`, a check that both are null
  or both set and the kind is `room | broadcast | recording`. No foreign key: a target deleted later shows as unavailable.
- `contracts.ts`: `PostEmbedInput {kind, id}`, `PostEmbed {kind, id, title|null, leader|null}`; `PostInput.embed` optional and
  `body` may be empty only with an embed (a refinement, 400 otherwise); `Post.embed` optional.
- `services/posts.ts`: `createPost` checks the target (`rooms`, `broadcasts`, `session_recordings`; 404 `embed.not_found`
  inside the transaction, so nothing is written); `withEmbeds` hydrates title and the leader's name (`user_display`) with one
  query per kind present, and sets `embed` only on posts that have one. Quotes keep their shape.
- OpenAPI and the generated client. Tests: `app/src/api.post-embeds.int.test.ts` (real Postgres). AC-003 compares the key set
  of a post without an embed with the list of keys the API had before this spec, from the timeline, the post page and a
  profile's posts.

## T-002 Links and the card in the surface (AC-001, AC-004, AC-005)

- `features/post/embed-link.ts`: `findEmbedLink(text, pageOrigin)` → `{kind, id, start, end, text}` for the first
  `/social/(r|b|rec)/<uuid>` link, bare or as an http(s) URL on `sefaria.org`, `www.sefaria.org`, `sefaria.org.il`,
  `www.sefaria.org.il`, `*.sefaria.org` (cauldrons, previews) or the page's own origin (from `host.href`).
- `features/post/linkify.tsx`: split text into strings and http(s) URLs (trailing punctuation left out); render `<a
href target="_blank" rel="noopener nofollow">`. No HTML is ever parsed from the text.
- `Composer.tsx`: on change, when there is no card yet and the text contains a link, cut it out and keep `{kind, id, text,
at}`; the card shows under the text with Remove, which re-inserts the link text at `at`. Posting sends `embed`; text may
  be empty with a card.
- `EmbedCard.tsx`: the card (title, "with <leader>", one button: Join, Watch, Play) that navigates through the host
  (`host.navigate(path)`; the href built by `host.href`, R8). Unavailable when title is null. Styles in
  `embed-card.module.css` using the kit tokens; not inside `[data-social-page=feed]`.
- `PostCard.tsx` renders `linkify(post.body)` and the card. Strings in English and Hebrew.
- Tests: `embed-link.test.ts`, `linkify.test.tsx`, `post-embeds.test.tsx` (composer and card with the fake host). AC-001's
  test types and pastes into the real composer; today there is no card (red). AC-004/005 render a `PostCard` with a body URL
  and an embed; today there is no link and no card (red).
