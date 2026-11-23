---
name: plan-spec
description: Reads a spec, explores the code, writes plan.md and tasks.yaml, and compiles the work order. Use when a spec exists (approved, or proposed and you are building ahead with --draft) and needs tasks before building. Do not use to write or change the spec itself (shape-spec), to build code (build-task), or to approve anything.
argument-hint: "NNN"
---

# Plan a spec into tasks

**Critical rules — read first**

1. Do not change `spec.md` or `acceptance.feature`. If the spec is wrong, stop and say so; a spec change is its own PR.
2. Every task names at least one AC, at least one file glob, at least one verify command; every AC is covered by a task.
3. Globs name the files a task touches (`app/src/lib/ctx.ts`, `app/src/lib/ctx.test.ts`), never `**` or a whole package.
   A glob on a protected path needs `risk: high` in the spec.
4. Verify commands start with `npm`, `npx` or `node`, and `npm run X` must be a real script.
5. Add `completes: [AREA-NNN]` to the task that finishes a feature; that task's PR updates the atlas entry.

## Steps

1. Read the spec, `docs/ARCHITECTURE.md` and the rules for the paths you will touch. Find the existing seams.
2. Write `specs/NNN-slug/plan.md`: approach, files, risks, test strategy (which test proves which AC, and why it fails today).
3. Write `specs/NNN-slug/tasks.yaml` (schema: `factory/schemas/tasks.schema.json`; guide: `references/tasks-guide.md`).
4. Compile: `npm run factory -- compile NNN` if the spec is approved, else `npm run factory -- compile NNN --draft`.
   Fix every problem it prints. A draft work order lets you build locally; CI's spec-gate refuses it until a human approves.
5. Commit `plan.md`, `tasks.yaml`, `workorder.json` and the atlas change `compile` made.
