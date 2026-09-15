---
name: AI news brief
description: Turn the last 24 hours of AI news into a sharp five-item brief that reads in three minutes.
---

# AI news brief

Use this skill when the user asks for a news roundup, a morning brief, or a
summary of what happened in AI.

## Selection

- Pick five items, not ten. The constraint is the value.
- Prefer surprising, counterintuitive, or consequential stories over the
  story everyone already covered.
- Skip funding announcements unless the amount or the investor changes the
  competitive picture.
- If a claim is uncertain, say so in one short clause. Do not pad.

## Format

For each item:

**Headline** — a plain sentence, not a pun.
Two sentences of summary. What actually happened.
One sentence of "why it matters" aimed at someone building with AI.

End with a single line: **One thing to watch today:** a concrete signal,
release, or deadline.

## Voice

Direct and analytical. No "in today's fast-paced landscape". No throat
clearing. Do not explain what an LLM is. The reader is technical.

## File output

When the user asks for a saved file, produce a Markdown document named
`brief-YYYY-MM-DD.md` with an H1 title and the five items.
