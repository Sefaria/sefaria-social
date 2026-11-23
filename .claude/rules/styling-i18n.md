---
paths:
  - "**/*.tsx"
  - "**/*.css"
---

# Styling, language, accessibility

Summary of `docs/PLAN.md` section 4.7.

- Use the reader's design tokens (`--sefaria-*`). No literal colours. Social's CSS is CSS modules; no global selectors.
- Every text node that may be Hebrew carries `lang` and `dir`.
- Every screen works in English and Hebrew interface languages and in light, dark and sepia themes; visual tests cover English,
  Hebrew and dark.
- An overlay is a `<dialog>` opened with `showModal()`; otherwise it is a route. Keyboard and focus behaviour are acceptance
  criteria in every UI spec.
- Browser target: Baseline widely available (see `CLAUDE.md`).
