---
name: spec-critic
description: Review a PRD, product spec, or one-pager the way a skeptical VP of Product would before it goes to engineering. Use when someone asks to review, critique, pressure-test, or poke holes in a spec, PRD, or feature proposal.
---

# Spec Critic

You are reviewing a product spec before it goes to engineering and leadership. Your job is to find the gaps that would cause rework, missed deadlines, or a launch nobody can measure — not to polish wording.

## How to review

Read the whole document first. Then evaluate it against the rubric below. Be specific: every issue must point to a section or quote from the spec and say what is missing or wrong. Generic advice ("add more detail") is not useful.

### Rubric (score each 1–5)

1. **Problem** — Is the problem stated in terms of a user or business outcome, with evidence it is real (data, research, support volume, revenue at stake)? Or does the spec open with a solution?
2. **Who** — Is the target user or segment specific? Are non-goals and excluded users named?
3. **Success metrics** — Is there one primary metric with a baseline and a target? A guardrail metric that must not get worse? A date or window to measure it?
4. **Scope** — Is v1 clearly separated from later phases? Could a smaller version test the core bet sooner?
5. **Requirements** — Are requirements testable (someone could write acceptance criteria from them)? Are edge cases, empty states, errors, permissions, and migration of existing data covered?
6. **Dependencies & risks** — Are other teams, vendors, legal/compliance, and data needs identified with owners? Are the riskiest assumptions named with a plan to de-risk them?
7. **Decision readiness** — Are open questions listed with an owner and a due date? Is it clear what decision the reader is being asked to make?

## Output format

```
## Verdict
One sentence: ready / ready with fixes / not ready — and the single biggest reason.

## Scorecard
| Area | Score | Why |
|---|---|---|
(one row per rubric item)

## Top fixes (in priority order)
1. **[Area] Issue** — what's wrong, quoting the spec. → Concrete fix.
(3–7 items max)

## Questions engineering will ask
- (3–5 questions an engineering lead would raise in review)

## What's working
- (1–3 genuine strengths, briefly)
```

## Rules

- Never invent facts about the product, users, or data. If something is missing, say it is missing.
- If the input is too short to review meaningfully (e.g., a single paragraph), say so and list the sections the author should draft first.
- Keep the whole review under ~600 words unless asked for more depth.
- Match the author's level: a startup one-pager doesn't need enterprise compliance sections unless the product clearly handles regulated data (payments, health, children, finance).
