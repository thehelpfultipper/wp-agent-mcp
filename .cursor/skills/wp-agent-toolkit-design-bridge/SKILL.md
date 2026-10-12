---
name: wp-agent-toolkit-design-bridge
description: Bridge Figma or screenshot design intent into WordPress repo conventions via WP Agent MCP. Use when the user asks to implement, build, or match a design in WordPress.
---

# Design Implementation Bridge

## When to use

Route here when the user:

- Shares a **Figma link** or node and wants it implemented in WordPress
- Attaches a **screenshot/mock** and asks to match the project design system
- Says "implement this frame/section/hero" with design context

Users stay in **natural language**. Never require tool names in user prompts.

## Prerequisites (transparent checks)

1. Call **`get_design_bridge_readiness`** (WP Agent MCP) first.
   - If `readyForBridge: false`, explain `blockers[]` and remediation before capture work.
   - Surface `companionMcps.figma.setupHint` when the user provided a Figma URL.
   - Surface `companionMcps.playwright.setupHint` only for post-implementation verification.

2. **Figma MCP availability (agent-side only)**
   - Before Figma capture, verify Figma MCP via dynamic tool discovery (`GetDynamicTools` pattern `figma`).
   - If missing and user gave a Figma URL: explain how to enable Figma MCP in Cursor Settings → MCP, then offer **screenshot fallback** (no Figma MCP required).

## Workflow (linear, quota-efficient)

1. Readiness → capture → **one** interpret pass → bridge → implement → verify
2. Do **not** spawn parallel subagents for bridge steps in v1.

### Capture

| Input | Action |
|-------|--------|
| Figma URL | One `get_design_context` call (load `figma-design-to-code` skill first) |
| Screenshot/image | Interpret image directly; skip Figma MCP |

### Interpret (agent, one pass)

Convert capture into **semantic** `visualIntent`:

- Layout structure + region roles
- Color roles (`background`, `text`, `accent`, …) — not raw hex as the primary signal
- Typography roles (`heading`, `body`, …)
- Spacing rhythm (`tight` / `normal` / `loose`, `sectionPadding`)
- Component labels/kinds

Raw Figma values may appear under `raw` hints only. Never send raw-only payloads (bridge returns `BRIDGE_INTENT_TOO_RAW`).

### Theme target

- Pass **`componentHint`** with a natural-language excerpt from the user's request (component description and optional theme mention, e.g. "card hero in our tht theme").
- Do **not** ask the user for `themeSlug`, `blogId`, or other tool fields.
- If the bridge returns `requiresThemeSelection: true`, ask the user **once in natural language** which theme to use (offer `themeCandidates`), then retry with the chosen theme reflected in `componentHint`.

### Bridge (single MCP call)

Call **`bridge_design_to_implementation`** with `visualIntent` (or `figmaCapture`) and **`componentHint`** from the user's request.

Use the returned **implementation spec**:

- `tokenReconciliation` → theme preset CSS vars
- `componentPlan.audit` → reuse / extend / create
- `implementationGuidance.avoidRawValues` → never paste Figma literals into theme files
- `verificationChecks` → Playwright or manual checklist

### Implement

- Read cited files via `read_project_file`
- Prefer reuse/extend per `componentPlan`
- Apply changes via `apply_patch` when appropriate

### Verify

- If Playwright MCP available: run `verificationChecks`
- Otherwise: present manual checks from the spec

## Anti-patterns

- Pasting Figma hex/spacing/font values directly into SCSS/PHP/theme.json
- Calling `get_theme_profile` + `audit_component` separately when bridge can bundle reconciliation
- Running `search_project_files`, terminal `grep`, or `rg` before the bridge when implementing from Figma/screenshot (bridge bundles audit + token reconciliation)
- Multiple Figma MCP reads for the same frame
- Parallel Task subagents for token matching (bridge is deterministic in WP Agent)

## Figma → visualIntent handoff

After one `get_design_context` call:

1. Set `visualIntent.layout.structure` from frame layout summary.
2. Add `components[].label` for each component/frame name (include block slugs such as `tht/card-hero` when visible).
3. Map colors/typography/spacing to **roles**; keep literals under `*.raw` only.
4. Or pass the capture object as `figmaCapture` and let the bridge derive a first-pass intent.

Include known block slugs in `components[].label` — layout text alone often misses indexed block matches.

## Example user prompts

- `Implement this hero section in our WordPress theme` + Figma link
- `[screenshot] Match this layout using our design system for the tht theme`
- `Turn this Figma frame into a block pattern` (ask for theme if missing)
