# PM Toolkit

**AI skills for product managers.** Four focused skills that help with the writing-heavy parts of product work: drafting specs, pressure-testing them, updating stakeholders, and making sense of customer research.

Each skill is a plain-English instruction file (`SKILL.md`). They run as a Claude plugin, and they work with any LLM if you paste them in as a system prompt.

| Skill | What it does | Try it with |
|---|---|---|
| [`prd-writer`](skills/prd-writer/SKILL.md) | Turns messy notes, threads, or transcripts into a structured PRD draft, flagging every gap as an open question instead of filling it with guesses. | [`examples/meeting-notes.md`](examples/meeting-notes.md) |
| [`spec-critic`](skills/spec-critic/SKILL.md) | Reviews a spec the way a skeptical VP of Product would, with a scored rubric, prioritized fixes, and the questions engineering will ask. | [`examples/weak-spec.md`](examples/weak-spec.md) |
| [`status-update`](skills/status-update/SKILL.md) | Converts a ticket export or standup notes into a weekly update, with a 5-line exec version and a detailed team version. | [`examples/tickets.csv`](examples/tickets.csv) |
| [`interview-synthesis`](skills/interview-synthesis/SKILL.md) | Clusters customer interviews into evidence-backed themes, with verbatim quotes only, and ranks the opportunities. | [`examples/interview-notes.md`](examples/interview-notes.md) |

## Design principles

AI writing tools tend to produce confident, polished documents that hide what nobody actually knows yet. For product work, that's the wrong failure mode. These skills are built around a few rules:

- **Never invent the numbers.** Baselines, targets, dates, and owners come from the input or get flagged as open questions.
- **Separate facts from assumptions.** Inferences are labeled so the author can confirm or cut them.
- **Evidence over eloquence.** Research synthesis uses only verbatim quotes and reports honest counts ("3 of 8 participants").
- **Outcomes over activity.** Status updates lead with what changed for users and what decisions are needed, not a list of tickets touched.
- **Short and decision-ready.** Every output is structured so a busy reader can act on it in under a minute.

## Install

### Claude Code

```
/plugin marketplace add robertfrazee-dev/pm-toolkit
/plugin install pm-toolkit@pm-toolkit
```

Then just ask, for example: *"Critique this spec"* or *"Turn these tickets into a weekly update."*

### Claude apps

Zip any folder under `skills/` and upload it as a custom skill in Claude's settings.

### Any other LLM

Copy the contents of a `SKILL.md` file (everything below the `---` header) into the system prompt or the start of your conversation, then paste your input.

## Examples

All example inputs use **Forkful**, a fictional meal-planning app, so you can try every skill on the same product and see how they connect: notes → PRD → critique → tickets → status update.

## Roadmap

- [ ] Before/after example outputs for each skill
- [ ] An eval set: sample inputs with checks (e.g., "no invented metrics," "every quote appears in the source")
- [ ] `launch-checklist` skill: go-to-market readiness review
- [ ] `metrics-tree` skill: break a north-star metric into drivers and experiments

## Contributing

Issues and pull requests are welcome, especially new skills or example inputs from real PM workflows (with anything confidential removed).

## License

MIT
