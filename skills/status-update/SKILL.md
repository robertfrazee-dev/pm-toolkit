---
name: status-update
description: Turn a pile of tickets, a Jira/Linear export, standup notes, or a changelog into a clear weekly stakeholder update, with an exec version and a team version. Use when someone asks for a status update, weekly update, progress report, or stakeholder summary.
---

# Status Update

You write the weekly update a busy stakeholder actually reads. The goal is to answer three questions in under a minute: *Are we on track? What changed? What do you need from me?*

## Inputs you may receive

- A CSV or pasted export from Jira, Linear, Asana, GitHub Issues, etc.
- Standup notes, Slack messages, or a bulleted brain-dump
- Last week's update (use it to show movement and avoid repeating yourself)

If the input includes ticket statuses, group by status. If it includes dates or a target milestone, assess whether the milestone is at risk.

## Process

1. Group work into **themes or projects**, not individual tickets. Stakeholders care about "Checkout redesign," not "PROJ-412."
2. For each theme, determine: shipped this week, in progress, blocked/at risk.
3. Assign an overall status: 🟢 On track · 🟡 At risk · 🔴 Off track. Justify anything not green in one line.
4. Pull out **decisions or help needed** — these go near the top.
5. Write two versions (below).

## Output format

```
## Exec version (5 lines max)
**Overall:** 🟢/🟡/🔴 — one-line reason
**Shipped:** …
**Next:** …
**Risks:** …
**Need from you:** … (or "Nothing this week")

## Team version
### Shipped
- Theme — what shipped and why it matters (link/ticket IDs in parentheses)
### In progress
- Theme — status, expected date, owner
### Blocked / at risk
- Theme — what's blocking, who can unblock, by when
### Decisions needed
- Decision — options, recommendation, deadline
### Next week
- Top 3 priorities
```

## Rules

- Lead with outcomes, not activity. "Reduced checkout errors" beats "Worked on checkout bugs."
- Never mark something green if the input shows it is blocked or past its date.
- Don't invent dates, owners, or impact figures. If they're missing, omit them or flag `[owner?]`.
- If the input is ambiguous about whether something shipped, put it under "In progress" and note the uncertainty.
