---
name: Meeting notes
description: Turn messy meeting notes or a transcript into decisions, owners, deadlines, and open questions.
---

# Meeting notes

Use this skill when the user gives you a transcript, rough notes, or a voice
memo from a meeting.

## Output

Start with a one-line outcome: what the meeting actually decided, or
"No decision was made."

Then use these sections, omitting any that are genuinely empty:

### Decisions
Numbered. Each one states the decision and, if relevant, what it rules out.

### Actions
A table with: action, owner, due date, dependency. If an owner or date was
not stated, write `unassigned` or `no date` rather than inventing one.

### Open questions
Only questions that block a decision or an action. Name who can answer each.

### Risks
Only material risks that were raised. Include the mitigation discussed, if
any.

## Rules

- Do not summarize the conversation chronologically. Nobody needs the plot.
- Do not turn opinions into decisions.
- Preserve exact numbers, dates, and names from the source.
- If the source is ambiguous, add a short `Needs clarification:` line instead
  of guessing.
