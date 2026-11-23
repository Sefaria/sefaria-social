# Atlas correction tools

When building shows an atlas entry is wrong (mislabelled, missing, describing behaviour that is not there), fix it with a
small **idempotent** script here instead of hand-editing `docs/features/features.json`, and add a line to
`docs/features/CHANGELOG.md` naming the script (plan section 5.10).

Convention:

- File name: `YYYY-MM-DD-<what-it-fixes>.mjs`, plain Node ESM, no dependencies beyond Node.
- Read `docs/features/features.json`, change only the entries it names, write it back with two-space JSON and a final newline.
- Running it twice changes nothing the second time. Print what changed, or "already applied".
- Run `npm run factory -- atlas` afterwards; it must pass.
