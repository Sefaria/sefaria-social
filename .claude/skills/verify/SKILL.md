---
name: verify
description: Runs every check for the current change and writes an evidence block — exact command, real output, PASS or FAIL per check, one adversarial probe, and a final VERDICT line. Use when you are about to claim work is done or open a PR. Do not use as a substitute for CI, to summarise output you did not run, or to soften a failure.
---

# Verify

**Critical rules — read first**

1. Evidence is a command you ran and its real output, pasted, not paraphrased. "Looks correct" is not evidence.
2. Any FAIL means VERDICT: FAIL, and no PR. Do not skip, retry-until-green, or mark a test optional.
3. Add one adversarial probe: break the behaviour on purpose (or name the assertion that would catch the break) and show
   the test goes red, then restore.

## Checks, in order

1. The task's own verify commands from the work order.
2. `npm run typecheck`, `npm run lint`, `npm run format:check`.
3. `npm run test:arch`, `npm run test:factory`, `npm test`.
4. `npm run factory -- atlas --base origin/<base>` and `npm run factory -- gate --base origin/<base>`.
5. `npm run factory -- prove-red --base origin/<base>` when you added or changed an `@ac` test.

## Output format

See `references/evidence-format.md`. End with exactly one line: `VERDICT: PASS` or `VERDICT: FAIL (<check>)`.
