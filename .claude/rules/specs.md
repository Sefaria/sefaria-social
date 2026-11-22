---
paths:
  - "specs/**"
  - "docs/features/**"
---

# Specs and the feature atlas

Summary of `docs/PLAN.md` sections 5.2, 5.3 and 5.10. Tooling: `npm run factory -- compile|atlas`; how-to: `docs/runbooks/working-in-the-factory.md`.

- Anyone may draft a spec, an agent included. A human agrees to it by approving the PR; approval is recorded only by
  `npm run factory -- approve <id> --by <email>`, run by that human. Never write an approval yourself.
- A spec change is its own PR; never change a spec and product code in the same PR.
- A spec that needs more than about eight tasks is split. UI specs include `mockup.html` using the reader's tokens.
- Every feature a spec adds or changes has an entry in `docs/features/features.json`. Ids are never reused or renumbered.
