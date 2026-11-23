Presentational components. Imports `lib` and `ui` only; never `server`. See docs/ARCHITECTURE.md.

- `SourceText.tsx`: social's own source-text renderer (plan 4.5, spec 017). It is the one file to replace when contract v1.1
  gives the surface `renderSegment`. Text comes from `lib/sefaria-text.ts` (validated, plain text only).
