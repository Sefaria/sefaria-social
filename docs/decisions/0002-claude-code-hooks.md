# 0002: Claude Code hooks, as the current docs define them

- Status: accepted (F1, 2026-11-23)
- Plan reference: section 5.4 (`[CHECK]` current hook event names and exit-code behaviour)
- Source: https://code.claude.com/docs/en/hooks, read 2026-11-23

## What the docs say today

- Event names used here exist unchanged: `PreToolUse`, `PostToolUse`, `Stop`. Registration is `.claude/settings.json` →
  `hooks.<Event>[] = { matcher, hooks: [{ type: "command", command, timeout }] }`. A matcher made only of letters, digits,
  `_`, `|` is an exact list of tool names (`Edit|Write`); anything else is a regular expression.
- Input is one JSON object on stdin. Common fields: `session_id`, `transcript_path`, `cwd`, `permission_mode`,
  `hook_event_name`. `PreToolUse`/`PostToolUse` add `tool_name`, `tool_input`, `tool_use_id` (`PostToolUse` also
  `tool_response`). For `Write`/`Edit`, `tool_input.file_path` is always absolute. `Stop` adds `stop_hook_active`
  (true when Claude is already continuing because of a stop hook) and `last_assistant_message`.
- Exit codes: `0` success (stdout parsed as JSON if it is one object); `2` blocking error, stderr is the reason shown to Claude
  (`PreToolUse`: the tool call is blocked; `PostToolUse`: the tool already ran, stderr is shown; `Stop`: Claude keeps going);
  **any other code is a non-blocking error and the action proceeds** — so an enforcing hook must use exit 2, never exit 1.
- `PostToolUse` can return `{"hookSpecificOutput": {"hookEventName": "PostToolUse", "additionalContext": "…"}}` to give the
  agent findings without blocking.
- Default command timeout is 600 seconds. `$CLAUDE_PROJECT_DIR` is the project root where the session started; it does not
  follow the session into a worktree.
- Loop protection for `Stop`: the docs say to check `stop_hook_active`; Claude Code also caps consecutive stop-hook
  continuations (8).

## Differences from the plan, and what we did

1. **Exit 1 does not block.** The plan says "exits with code 2"; that matches. Every blocking path in our hooks exits 2, and
   `guard-paths` fails closed (exit 2) when the input has no `file_path` it can read.
2. **`MultiEdit` is not documented any more** (only `Write`, `Edit`, `Read` input schemas are). The matcher still lists
   `MultiEdit` and `NotebookEdit` (`notebook_path`) so the guard holds if either tool is available; an unknown tool name is
   allowed (it cannot write files).
3. **`$CLAUDE_PROJECT_DIR` does not follow worktrees.** `guard-paths` therefore finds the repository from the edited file's
   own path (nearest `.git`), not from the environment variable, and guards only checkouts that carry this hook.
4. **Bash can still write files.** The hooks guard the file tools only. The plan forbids regex over command strings, so a
   shell redirect into product code is not blocked locally; CI's `spec-gate` is the backstop, and `.claude/settings.json`
   denies the approve command and edits to `specs/approvals.json` as a second line.
5. Timeouts are set explicitly (10 s guard, 60 s post-edit, 300 s stop) instead of the 600 s default, so a hung check cannot
   hold a session.
