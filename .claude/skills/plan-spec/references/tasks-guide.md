# tasks.yaml guide

```yaml
- id: T-001
  title: ctx codec with validation
  acs: [AC-001, AC-003]
  files: ["app/src/lib/ctx.ts", "app/src/lib/ctx.test.ts"]
  depends_on: []
  parallel: true
  verify: ["npm test -- ctx", "npm run typecheck"]
  completes: [SESS-004]
```

- One task = one session = one PR. Keep tasks small enough to review in one sitting.
- `depends_on` must not form a cycle. `parallel: true` marks tasks that can be built at the same time.
- The test for an AC is written first and must fail on the merge base for an assertion reason (`prove-red` checks it), so
  plan tests against modules that already exist on the base, or create the seam in an earlier task.
