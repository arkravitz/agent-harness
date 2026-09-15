---
name: Landing page
description: Build a polished, responsive, single-file landing page artifact with no external dependencies.
---

# Landing page

Use this skill when the user asks for a landing page, one-pager, product page,
or promotional site.

## Artifact rules

- Output exactly one `html artifact="Title"` block.
- One self-contained file. Inline CSS and JavaScript. No CDNs, frameworks,
  web fonts, or remote images.
- Use CSS gradients, SVG, and typographic scale instead of stock imagery.
- Responsive from 360px to 1440px. No horizontal scrolling.
- Keyboard accessible: visible focus states, semantic landmarks, labels on
  every input, sufficient contrast.

## Page structure

1. Hero: product name, one-sentence promise, primary CTA, one visual proof
   element (metric, product mock, or diagram).
2. Three benefits. Each gets a short headline, two sentences, and a simple
   inline SVG icon.
3. Social proof: two or three testimonials with names and roles. Keep them
   plausible and specific; do not invent logos.
4. Contact form with name, email, and message. Client-side validation and a
   success state. Do not pretend to submit anywhere.
5. Footer with a copyright line.

## Design defaults

- Dark background, high contrast, large display type.
- One accent color. Use it for the CTA and almost nothing else.
- Generous whitespace. Sections separated by rhythm, not boxes inside boxes.
- Subtle motion only: one entrance animation, respect
  `prefers-reduced-motion`.

## Copy

Concrete over clever. "Ship a landing page in 10 minutes", not "Unleash your
digital potential". No exclamation marks in headlines.
