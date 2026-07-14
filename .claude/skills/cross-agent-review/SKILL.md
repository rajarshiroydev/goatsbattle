---
name: cross-agent-review
description: >-
  Run the tightly-coupled Claude Code + Codex collaboration loop for this repo:
  verify locally, record durable gotchas in AGENTS.md, get Codex to review the
  change, triage its findings, and route follow-ups to Linear. Use this whenever
  wrapping up a nontrivial change and the user wants a Codex cross-review or
  hand-off — triggers include "run the cross-agent loop", "hand this to Codex",
  "get Codex to review this", "close out this change", "cross-review before I
  merge", or finishing work that should be reviewed by the other agent. Requires
  the openai codex-plugin-cc plugin (the /codex:* commands).
---

# Cross-agent review loop (Claude Code ⇄ Codex)

This repo is worked by **both** Claude Code and Codex, reviewing each other. This skill
runs the wrap-up loop for a change: verify it, share what was learned, get Codex to
challenge it, and fold the results back in. The goal is that neither agent re-hits a
problem the other already solved, and that no change merges without a second set of eyes.

Read `AGENTS.md` first if you haven't this session — it's the shared source of truth
(symlinked as `CLAUDE.md`, so Codex reads the same file). **Agent-private memory is not
shared and does not count** as recording a learning.

## When to run
After a nontrivial change is functionally done and about to be handed off, reviewed, or
merged. Skip it for trivial edits (typos, comments) — the point is a real second opinion,
not ceremony.

## The loop

### 1. Verify locally
Prove the change works before asking Codex to spend time on it.
- Run `./node_modules/.bin/tsc --noEmit 2>&1`. **Capture `2>&1`** — `tsc` writes diagnostics to *stdout*,
  not stderr, so stderr-only checks make real errors look like a clean pass.
- If the change is observable in the browser preview, drive the affected flow (dev server
  on port 4321 via `.claude/launch.json`) and confirm it — don't ask the user to check.

### 2. Record durable learnings in AGENTS.md
If diagnosing this change taught something non-obvious (a root cause, a footgun, a runtime
quirk), add it to the **"Engineering gotchas / hard-won learnings"** section of `AGENTS.md`
in `symptom → cause → fix` form, referencing concrete files. This is the only place a
learning is actually shared with Codex — writing it only to private memory means Codex
re-hits it blind. If deps or tooling changed, update `STACK.md` too. Verify claims against
current code before writing them.

### 3. Get Codex to review
The review commands are **user-invoked only** (`disable-model-invocation: true`) — you
**cannot** run them yourself. Present the exact command for the user to paste, then wait
for them to bring back Codex's output.

- Default to the adversarial review (it challenges the approach/assumptions, not just
  defects), backgrounded for anything beyond ~1–2 files:

  ```text
  /codex:adversarial-review --background
  ```

- Use plain `/codex:review` when the user only wants a defect pass over the diff.
- Add `--base <ref>` to review a whole branch instead of the working tree.

Tell the user to run it and paste the findings back here. Do **not** claim the review ran
or invent its output.

### 4. Delegate deeper work to Codex (optional)
Unlike the review commands, `/codex:rescue` **is** model-invocable — run it by invoking the
`Agent` tool with `subagent_type: "codex:codex-rescue"`, forwarding the investigation/fix
request as the prompt. Use this to hand Codex a bug hunt or a self-contained fix while you
continue other work. (Do not `Skill(codex:rescue)` — there's no such skill; that path
hangs.)

### 5. Triage Codex's findings
For each finding: apply it, or deflect it with a stated reason (don't silently ignore).
When you deflect a review-bot/Codex finding, record *why* so the reasoning is visible to
the other agent. Any finding that reveals a durable gotcha goes back into `AGENTS.md`
(step 2) so it's captured once and for all.

### 6. Route remaining follow-ups to Linear
Out-of-scope or later work goes to the relevant **Linear** `GBT-*` ticket, not a file.
**Do not create a handoff document** — `CLAUDE_HANDOFF.md` was deliberately retired;
what's-next lives in Linear, durable learnings in `AGENTS.md`, and both agents read those.

## Guardrails
- Deploys (`worker:deploy:preview`/`:production`) and production DB operations are
  approval-gated — never trigger them as part of this loop without explicit user say-so.
- Keep secrets out of AGENTS.md/STACK.md/Linear (no tokens, keys, or connection strings).
- If the codex-plugin-cc plugin isn't installed, steps 3–4 won't work — tell the user to
  install it (`/plugin install codex@openai-codex`, then `/codex:setup`) rather than faking
  a review.
