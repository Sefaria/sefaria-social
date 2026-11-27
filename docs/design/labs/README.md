<!--
The Sefaria Labs design system, as context for anyone (person or agent) building Labs products in this repo.
This is a copy of Zohar's design system on claude.ai (https://claude.ai/artifact/Kvv5SDmwdyhoy8VpevxSKD; ask Zohar for access),
updated to the decisions approved in spec 060 (PR #39). tokens.json is the palette, type and spacing as data. When the two
disagree with code, code wins: with PR #39, app/src/ui/brand.module.css holds Social's palette once.
-->

# Sefaria Labs

**Torah learning, in beta.** Sefaria Labs is Sefaria's lab for AI-native learning. It builds new ways to learn on the open library and ships them in public. Its flagship is **Sefaria Social** ("The library, live."): rooms where people learn a text together in real time, margin notes that stay on the text, and sessions that turn into lasting assets. Next come Surfaces (plugins and experimental reader views) and a Learner Model.

This one system serves the Labs brand and every Labs product. It is Sefaria's design system with its own take. It keeps Sefaria's blue, its Garamond text voice, Taamey Frank for Hebrew, Roboto and Heebo for UI, and the library's category colors. It adds a dark _Night_ theme, a mono "machine" type, and two signal colors: one for _live_ and one for _AI_.

> Sefaria is the library: calm, permanent, trusted. Sefaria Labs is the workshop next to it: experimental, live, AI-native. Same books, new tools.

## Two moods, one family

|               | Sefaria Labs                                          | Sefaria Social                                                                                            |
| ------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Mood          | A workshop at night: experimental, precise, AI-native | **Joy, curiosity, discovery, connection**                                                                 |
| Default theme | Night                                                 | **Daylight** (Night when the reader is dark)                                                              |
| Lead accent   | Spark violet (the machine) and the mono layer         | Sunny gold (`sun`, `highlight`, `gold`) and a cursor colour for every learner                             |
| Type          | Garamond headlines, mono for labels and data          | Three voices: mono for what the system says, serif for what people wrote, sans only for small helper text |
| Motion        | None                                                  | Small delights: the live dot pulses, a given Yasher koach pops                                            |
| Mark          | Cursors live + spark                                  | Cursors live + gold                                                                                       |

Labs owns the channels (The Margin, Hava Amina, @SefariaLabs) and anything AI. Social is what learners open. When in doubt inside Social, choose warmth over precision.

## Sefaria Social: Daylight

Social should feel like walking into a beit midrash on a bright afternoon: people you know, a table full of open books, someone waving you over.

- **Daylight by default: white paper.** `surface` and `surface-raised` #FFFFFF, `surface-sunken` #F7F5F0, `line` #E6E8EE, ink #1B2233, brand #1E3F73. The page stays white; the identity lives in the type and the colour signals. Under the reader's dark theme Social uses Night.
- **Gold is warmth and action.** The primary button is a `sun` pill (#E6C873) with `on-sun` ink text, one per view. `highlight` #F6E7B8 sits behind selected text and the Question label. `gold` marks the unread count, the active tab's underline and a given Yasher koach. Secondary buttons are quiet, with an ink border.
- **Every learner has a cursor colour.** An avatar is drawn as presence: a white circle with a ring in the person's `cursor-*` colour (gold, blue, sky, coral, moss, rose) and ink initials in mono. Never teal or violet, which are signals. The same person always wears the same colour, and it follows them in a room: avatar ring, cursor, margin notes. Rings hold 3:1 on white; initials 4.5:1.
- **Curiosity is visible.** A post that asks a question carries a gold "Question" label (Hebrew "שאלה"). Questions are invitations; show them.
- **Discovery uses the library's colors.** Wherever a source's category is known, its color can mark it (a card's edge, a ref chip), so browsing feels like walking the shelves.
- **Delight, briefly.** The live dot pulses slowly (1.6s). A Yasher koach turns gold and pops (320ms). A siyum deserves a celebration. Nothing moves under reduced motion, and nothing loops except the live dot.
- **Warm serif headings.** Page headings use the text serif at weight 500, never bold sans.
- **Mono for what the system says.** Nav and tabs, section labels, refs, times, counts, status labels such as LIVE, and buttons are set in the Labs mono, in capitals with tracking. What people wrote (posts, room names, names, the composer) is serif. The interface sans is only for small helper text.
- **Live and quiet.** A live room card carries the teal dot, the LIVE label and a teal cursor bar at its reading-start edge. A room that is not live is drawn quietly: no fill, a muted name.
- **Teal still means live; violet still means AI.** Neither is decoration inside Social.

This direction is built in sefaria-social PR #39 (spec 060). The reader's own Labs skin, sefaria-project PR #4164 (the `labs_skin` lab), keeps the text page white and puts the Labs identity in the chrome: a Night header with a teal-to-violet rule and a LABS mark, mono navigation and refs, gold verse numbers and a gold cursor bar on the chosen verse, the `sun` Sign Up, violet only for the assistant.

## Principles

1. **The text is the room.** Every surface points back to a source and a ref. Lead with the pasuk, not the feature.
2. **Two is the smallest unit of learning.** Chavruta is the model. Show presence: who is here, where they are, what they noticed.
3. **Live, then lasting.** Everything that happens live leaves an asset: recording, notes, a generated source sheet.
4. **The machine is labeled.** AI is a study partner, never an authority. Anything a model wrote wears `spark` and the mono label `AI`, and links to its sources.
5. **Open lab.** We ship early and say what's broken. Experimental surfaces are marked "Labs," never hidden.

## Content fundamentals

**Voice:** the best chavruta you ever had. Curious, warm and precise. Willing to push back, and always pointing at the text.

- Use refs, not vague nouns: "Malachi 2:11", not "a verse".
- Use Hebrew and Aramaic terms freely and gloss them on first use: _hava amina_ (the first assumption), _chazara_ (review).
- Keep sentences short. One idea per post. Sentence case for UI and headings.
- Be concrete about AI: say what the model did ("Claude drafted the source sheet; the teacher edited two refs").
- Never use hype words (revolutionary, disrupt, game-changing), emoji in brand copy, or exclamation marks in UI.
- Name people. Credit teachers on every asset that comes from their room.

| Do                                                 | Don't                                        |
| -------------------------------------------------- | -------------------------------------------- |
| "Room open · Malachi 2 · 20:00 IL"                 | "Join our amazing live learning experience!" |
| "Shipped: live margin notes. Broke: screen share." | "We're excited to announce…"                 |
| "AI summary · 6 sources"                           | Unlabeled machine text                       |

## Visual foundations

**Three grounds, no more.** _Night_ (`surface` #0B1426) is the hero theme for Labs channels and anything AI. _Parchment_ (`surface` #F4EFE4) is Labs' light theme for reading, newsletters and print. _Daylight_ (`surface` #FFFFFF, white paper) is Sefaria Social's own light theme (see above). Never invent a fourth.

### Color roles: each signal means one thing

| Token                              | Means                                                                 | Never                          |
| ---------------------------------- | --------------------------------------------------------------------- | ------------------------------ |
| `sefaria-blue`, `sefaria-blue-lit` | Sefaria. Brand fields.                                                | Text on Night                  |
| `brand`                            | Links, primary actions                                                | Decoration                     |
| `live`                             | Live now: presence, the live dot, the cursor you follow               | Anything that isn't live       |
| `spark`                            | AI wrote or suggested this                                            | Human content, generic accents |
| `gold`, `highlight`                | Margin notes, highlighted text, the second cursor                     | Warnings                       |
| `sun`                              | The one primary action (a gold pill, `on-sun` text)                   | Text, decoration               |
| `cursor-*`                         | One color per learner in Social: avatar ring, cursor, notes           | Body text, signals             |
| `presence-*`                       | One color per learner in a room (from the library's category palette) | Body text                      |

A screen holds at most one live element that pulses. If everything is live, nothing is.

### Type: the serif is the text, the mono is the machine

- **Serif** (`--font-serif`, Adobe Garamond with EB Garamond as fallback): the source text, headlines, pull quotes. This is Sefaria's reading voice, kept as is.
- **Hebrew** (`--font-hebrew`, Taamey Frank with Frank Ruhl Libre as fallback): pesukim and Hebrew sources, always in Hebrew script where the format allows.
- **Sans** (`--font-sans` Roboto, `--font-hebrew-sans` Heebo): product UI, as in Sefaria.
- **Mono** (`--font-mono`, JetBrains Mono): new. Used for refs, timestamps, live counts, badges and AI labels. Set ref tags and labels in uppercase with tracking (styles `.ref`, `.label`). Mono never sets body copy.

### The signature motif: the Margin

A block of text in the center, with live annotations around it: presence carets, highlights, margin notes and mono ref tags. It is a Talmud page drawn as a live interface. Build it from the tokens:

- Text lines drawn as `radius-pill` bars at a `space-6` pitch.
- **Cursor carets** are 4px-wide vertical bars in `live` (the one you follow) and `gold` (the second learner), placed at the end of a line, never crossing one.
- Ref tags (`MALACHI 2:11 · 4 LEARNING`) in mono, `ink-muted`, at a block's top-left.

Use the motif once per surface, as the image. Don't scatter it as decoration.

### Shape, depth and motion

- Corners: `radius-md` (6px, Sefaria's) for UI, `radius-lg` for panels and art blocks, `radius-pill` for presence.
- Depth comes from surface steps (`surface-sunken` → `surface` → `surface-raised`) and `line` hairlines. No drop shadows, gradients or glows. "Futuristic" comes from the signal colors and the mono layer, not from effects.
- Motion: only the live dot pulses (1.6s, opacity 1 → .45). Carets blink at 1s when a person is typing. Nothing else moves.

### Imagery

No stock photos of people learning. Use the Margin motif, real screen captures of rooms, and Hebrew typography. Teachers' own photos only with consent, on Parchment, in duotone (`ink` + `surface`).

## Logo: one mark, many cursors

The mark is a page with three lines of text and two cursors on it. The cursor colors say whose mark it is:

| Brand                | Cursors                       | Lockup                               | Means                                |
| -------------------- | ----------------------------- | ------------------------------------ | ------------------------------------ |
| **Sefaria Labs**     | `live` + `spark`              | "Sefaria" + "labs" with a spark dot  | A learner and a machine on one text  |
| **Sefaria Social**   | `live` + `gold`               | "Sefaria" + "social" with a live dot | Two learners on one text: a chavruta |
| Future Labs products | `live` + a `presence-*` color | "Sefaria" + product word             | Assigned when the product is named   |

- Lockups set "Sefaria" in Garamond 500 and the product word in mono 500.
- Files are in Assets → Logos (`labs-*` and plain `lockup-`/`mark-` for Social), in Night and Parchment versions. Clear space is half the mark's width. Minimum mark size is 20px; below 32px, drop the lockup and use the mark.
- A Labs product carries "from Sefaria Labs" in its channel art until it graduates into core Sefaria.
- The "Sefaria" in the lockups is set in EB Garamond. **Swap it for Sefaria's official wordmark before public use.**

## Iconography

Use Sefaria's existing UI icon set inside the product. In channel art, use no icons; use the motif and type instead. The only brand glyphs are the live dot (`radius-pill`, `live`) and the caret.

## Channels

| Channel                     | Ground                                 | Lead element                             |
| --------------------------- | -------------------------------------- | ---------------------------------------- |
| The Margin (Labs' Substack) | Parchment for issues, Night for header | Serif headline, mono issue label         |
| Hava Amina (Labs' podcast)  | Night                                  | Hebrew + English title, the Margin motif |
| X @SefariaLabs              | Night                                  | Ref cards, room-open cards, quote cards  |

Templates live in the companion launch-asset canvas.

## Using this system

Colors are semantic tokens with two themes; Night is first and is the fallback. Each token's usage note says where it is legible. Components here are CSS-only (`components/bundle.css`, class prefix `ss-`, from their first use in Sefaria Social). Load `tokens.css` and then `bundle.css`, and use the markup shown in each preview. Fonts: EB Garamond and JetBrains Mono are included as files; Roboto, Heebo and Frank Ruhl Libre load from Google Fonts; Adobe Garamond and Taamey Frank come from Sefaria's own font hosting when available.
