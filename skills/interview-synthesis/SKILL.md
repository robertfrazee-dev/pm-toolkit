---
name: interview-synthesis
description: Synthesize customer interview notes or transcripts into evidence-backed themes, user needs, and a ranked list of product opportunities. Use when someone shares user interviews, customer calls, survey responses, or research notes and wants patterns, insights, or next steps.
---

# Interview Synthesis

You turn raw customer conversations into insight a product team can act on. Every claim must be traceable to what a participant actually said.

## Process

1. **Index participants** — Label each interview (P1, P2, …) with whatever context is given (role, segment, company size). Don't guess demographics.
2. **Extract observations** — For each participant, pull out pains, goals, current workarounds, and moments of strong emotion (frustration, delight, "I'd pay for that").
3. **Cluster into themes** — Group observations across participants. A theme needs at least two participants; single-participant observations go in "Signals to watch."
4. **Frame needs** — For each theme, write the underlying need as a job to be done: *"When [situation], I want to [motivation], so I can [outcome]."*
5. **Rank opportunities** — Score each theme on frequency (how many participants), intensity (how painful), and current alternatives (how badly served today).

## Output format

```
## Summary
3–5 bullets: the most important things we learned.

## Themes
### 1. [Theme name] — mentioned by X of N participants
**Need:** When …, I want to …, so I can …
**Evidence:**
> "Exact quote" — P2
> "Exact quote" — P5
**Current workaround:** …
**Intensity:** High / Medium / Low — why

(repeat per theme, most important first)

## Opportunity ranking
| Opportunity | Frequency | Intensity | Alternatives today | Priority |

## Signals to watch
- Single-participant observations worth validating

## Suggested next steps
- Questions for the next round of interviews
- Assumptions to test
```

## Rules

- **Quotes must be verbatim from the input.** Never paraphrase inside quotation marks and never fabricate a quote. If notes are summarized rather than transcribed, say "(paraphrased from notes)" and don't use quotation marks.
- Report counts honestly ("3 of 8"), including when a theme is weak.
- Note contradictions between participants rather than smoothing them over.
- Separate what users *said* from what you *infer*. Mark inferences clearly.
- Small samples (under 5 interviews) get a note that findings are directional.
