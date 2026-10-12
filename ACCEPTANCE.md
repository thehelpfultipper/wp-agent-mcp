# Acceptance: Natural MCP Demo Flow

This acceptance guide verifies that a teammate can use the WP Agent MCP through normal conversation prompts, without endpoint-style or transport-style phrasing.

## Required demo prompts

Run the demo using these exact user prompts:

1. `Do we already have a compact testimonial section?`
2. `Find pages or templates that use a footer disclosure.`
3. `Summarize the active theme's design system.`
4. `Apply the prepared patch to add a compact testimonial variant.`
5. `[screenshot attached] Match this layout using our design system for the tht theme`

## What good looks like

- The interaction reads like a normal teammate request, not an API call.
- The assistant routes to the right public MCP tools behind the scenes.
- Results are concrete and project-specific (matches, files, usage locations, or theme conventions).
- Patch application happens safely: preview, checks, and explicit apply request.

## Pass/Fail checklist

- [ ] No user prompt references raw endpoints, HTTP verbs, or JSON payload shaping.
- [ ] No prompt or example uses explicit skill headers, HTTP route syntax, or payload-body scaffolding.
- [ ] Component existence/variant response is clear enough to support reuse/extend/create decisions.
- [ ] Footer disclosure usage returns pages, templates, patterns, or files with confidence/reasons.
- [ ] Theme summary explains active tokens, helpers, and naming conventions in plain language.
- [ ] Patch step applies the prepared diff and reports changed files and safety checks.
- [ ] Design bridge prompt (Figma link or screenshot) routes without tool names and avoids raw Figma token paste into theme files.
- [ ] A teammate can follow the flow in one read-through without needing transport details.

## Explicit anti-patterns to avoid

- Any prompt that reads like a backend operation instead of a teammate request.
- Any instruction that asks for payload construction or transport-level formatting.
- Any flow that requires endpoint names to understand or run the demo.

If endpoint-style wording appears, rewrite it as natural user language.
