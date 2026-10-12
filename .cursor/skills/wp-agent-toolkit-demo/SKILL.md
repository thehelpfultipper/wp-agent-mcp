---
name: wp-agent-toolkit-demo
description: Produces a repeatable demo script and acceptance checklist proving the POC works: connect, index, audit, similarity search, design system profile, patch apply.
---

# Demo & Acceptance (POC)

## When to use
Use when validating the POC or preparing a shareable Marketplace submission.

## Demo prompts (must include)
1) "Do we already have a compact testimonial section? Where is it defined and used?"
2) "Find all pages using a footer disclosure like `.footer-disclosure`."
3) "Summarize the active theme design system tokens and helper functions."
4) "If compact testimonial variant is missing, propose lowest-risk way to add it and show a diff."

## Acceptance checklist
- Index builds and reports counts (blocks/patterns/templates/content).
- Component audit returns verdict + candidates + usage + variants.
- Similarity search returns grouped matches + confidence.
- Patch workflow shows diff and can apply safely (optional).
