# Feature map

This document maps every item in the source guide ("La mayoría usa Claude al
10%. Y ni lo sabe.") to what the MVP actually does. The guide is about Claude;
this project is a local harness that keeps the same ideas without requiring a
Claude subscription, a browser extension, or cloud connectors.

Legend:

- **Included**: implemented and usable in the app.
- **Partial**: the useful subset is implemented with a deliberate boundary.
- **Excluded**: skipped for this MVP, with the reason.

| # | Guide item | Status | Implementation / reason |
| --- | --- | --- | --- |
| 1 | Projects | Included | `projects` table with fixed instructions and text documents. Every chat in a project gets them in its system context. |
| 2 | Artifacts | Included | HTML/SVG fenced blocks with `artifact="Title"` are extracted, stored, and rendered in a sandboxed iframe. A localStorage bridge gives apps persistence. |
| 3 | Extended reasoning | Included | **Think** toggle. Anthropic uses native thinking with a 4k budget. OpenAI o-series/GPT-5 models use `reasoning_effort`. The demo shows sample reasoning. |
| 4 | Memory | Included | Manual entries plus `<memory>` tags emitted by the model. Injected into every conversation and toggleable in Settings. |
| 5 | CBT therapist prompt | Included | Library template, English translation, placeholders preserved. |
| 6 | Honest mentor prompt | Included | Library template. |
| 7 | Personal trainer prompt | Included | Library template with all fields from the guide. |
| 8 | Difficult conversation rehearsal | Included | Library template. |
| 9 | Devil's advocate prompt | Included | Library template. |
| 10 | Claude in Chrome | Excluded | Requires a Chrome extension, installation outside the workspace, broad page access, and browser automation. The harness has no browser control by design. |
| 11 | Files on your computer | Partial | Text documents can be attached to projects and read by the model. No arbitrary filesystem access, no PDF/Word/Excel parsing. This keeps the app inside its workspace. |
| 12 | Scheduled tasks | Included | Local scheduler with daily, weekday, hourly, and interval plans. Saves Markdown output and run history. It is not a cloud cron: the process must be running. |
| 13 | Skills | Included | `skills/<id>/SKILL.md` files, parsed and attached to chats or tasks. Create/edit/delete from the Skills page. |
| 14 | CLAUDE.md | Included | Reimplemented as `AGENTS.md`, editable in the Instructions page. Falls back to `CLAUDE.md` if `AGENTS.md` is missing. |
| 15 | Claude Code | Excluded | A coding agent needs shell execution, tool approval, sandboxing, git awareness, and a test loop. That is a different product surface and a large security boundary. |
| 16 | Design (landing pages, decks) | Included | Design work is produced as an artifact. The Library has a landing-page brief; the `landing-page` skill enforces responsive, accessible, single-file output. Decks are not a dedicated format in the MVP. |
| 17 | Prompt caching | Included (Anthropic) | Stable and dynamic system blocks are marked `cache_control: {"type":"ephemeral"}`. No UI; caching is a provider-level optimization. OpenAI-compatible providers handle it on their side. |
| 18 | Video editing | Excluded | Needs ffmpeg and media files. It is a useful trick, but not a core harness capability and would add a system binary dependency. |
| 19 | Connectors (Gmail, Calendar, Drive, Notion) | Excluded | Requires OAuth apps, scopes, token storage, and live network access. Too much security and setup surface for the MVP. |
| 20 | Photo to spreadsheet | Excluded | Requires image upload plus a vision-capable model and reliable table extraction. The Library includes the receipt prompt for pasted text as a partial substitute. |
| 1 | Content research project instructions | Included | Seeded example project uses the guide's instructions. |
| 2 | Habit tracker artifact prompt | Included | The offline demo produces a complete five-habit, seven-day tracker with streaks, animation, localStorage, and a reset button. |
| 3 | Decision prompt | Included | Library template. |
| 12 | Weekday 7:30 brief | Included | Available as a Library prompt to paste into a task. The demo produces an explicitly labeled sample, not live news. |
| 13 | Skills as apps | Included | Local skills only. There is no skill marketplace or remote install. |
| 14 | Newsletter writing rules | Included | `newsletter-voice` skill translates the example CLAUDE.md rules. |
| 16 | Landing page prompt | Included | Library template plus artifact renderer. |
| 18 | Video prompt | Excluded | No media pipeline. |
| 19 | Email/calendar prompt | Excluded | No connectors. |
| 20 | Receipt prompt | Partial | Works with pasted text; image input is not implemented. |

## Why the boundaries are where they are

The request was to make only local changes and install nothing globally. That
rules out the guide's integration-heavy features:

- Browser extensions and OS-level file access need installers and permissions.
- Connectors need OAuth and a persistent token store.
- Video editing needs a system codec/binary pipeline.
- A coding agent needs command execution, which is a much larger security
  surface than a chat app should take on in an MVP.

What remains is the part that changes daily use: persistent context (projects,
memory, instructions), reusable instructions (skills, role prompts), and
generated working software (artifacts), plus a local scheduler for repeated
prompts.

## Two deliberate product choices

1. **Demo mode is first-class.** A new user should be able to inspect every
   feature without a key. The demo returns real, working artifacts and clearly
   labels canned text.
2. **The harness is honest about its limits.** The system prompt tells the model
   it cannot browse, read email, or run commands. This prevents the most common
   failure mode of a local MVP: pretending to have integrations it does not
   have.
