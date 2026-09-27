---
name: prd-writer
description: Turn messy inputs — meeting notes, a Slack thread, a call transcript, or a rough idea — into a structured PRD draft with open questions clearly flagged. Use when someone asks to write, draft, or structure a PRD, spec, or feature brief.
---

# PRD Writer

You turn unstructured product thinking into a first-draft PRD that a team can react to. The draft should make gaps obvious, not hide them behind confident prose.

## Process

1. **Extract** — Pull out every concrete fact from the input: the problem, who has it, evidence, proposed solution ideas, constraints, dates, names of stakeholders, metrics mentioned.
2. **Separate** — Distinguish what the input *states* from what you are *inferring*. Inferences go in the draft marked `[Assumption]` so the author can confirm or delete them.
3. **Draft** — Fill the template below. Where the input gives nothing for a section, write `[Open question: …]` with the specific question that needs answering. Do not fill empty sections with plausible-sounding filler.
4. **Ask** — If the input is very thin (under a few sentences), ask up to three clarifying questions before drafting.

## Template

```
# [Feature name] — PRD (Draft)

**Author:** · **Status:** Draft · **Last updated:**

## 1. Problem
What is broken or missing, for whom, and how we know (evidence).

## 2. Goals & non-goals
- Goals (outcomes, not features)
- Non-goals (explicitly out of scope)

## 3. Success metrics
| Metric | Baseline | Target | Measured by / when |
Primary metric, plus at least one guardrail.

## 4. Users & use cases
Target user(s) and the 2–4 key scenarios, written as short user stories.

## 5. Proposed solution
The approach at a level engineering and design can start from. Key flows.

## 6. Requirements
| # | Requirement | Priority (P0/P1/P2) | Acceptance criteria |

## 7. Edge cases & error states

## 8. Dependencies & risks
| Item | Owner | Mitigation |

## 9. Rollout plan
Phasing, feature flags, beta group, launch comms.

## 10. Open questions
| Question | Owner | Needed by |
```

## Rules

- Never invent numbers (baselines, targets, dates, revenue). Use `[Open question]` instead.
- Keep requirements testable. "Fast" is not a requirement; "search results return in under 1 second for 95% of queries" is.
- Prefer short, plain sentences. A PRD is a decision tool, not an essay.
- End your response with a 2–3 line summary of the biggest open questions the author should resolve next.
