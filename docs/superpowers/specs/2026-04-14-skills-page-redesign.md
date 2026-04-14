# Skills Page Card Enhancement — Design Spec

**Goal:** Add category-colored left border accents and Builtin/Installed badges to skill cards on the Hermes dashboard skills detail page.

**Design Reference:** [Nous Research Skills Hub](https://hermes-agent.nousresearch.com/docs/skills/) — each skill card has a left color line matching its category, with a badge indicating whether it's a built-in skill or separately installed.

---

## Architecture

### 1. Backend — `status_checker.py`

Add `_parse_bundled_manifest()` method that reads `skills/.bundled_manifest` from the profile directory.

The manifest format is `skill_name:git_sha` per line (e.g., `ascii-art:5b776ddc...`).

Each skill returned by `_list_skills()` gets an additional field:
```python
"is_bundled": True  # if skill name found in .bundled_manifest
```

### 2. Frontend — `app.js` `renderSkillsList()`

For each skill card, add:
- **Left border**: 4px solid color based on category
- **Badge**: `Builtin` (green) or `Installed` (blue) in top-right corner

### 3. CSS — `style.css`

Category-to-color mapping for left border accents:

| Category | Color (hex) | Description |
|----------|-------------|-------------|
| `social-media` | `#1DA1F2` | Social platforms |
| `github` | `#6e7681` | GitHub integrations |
| `creative` | `#E040FB` | Art, music, design |
| `research` | `#00BCD4` | Academic research |
| `software-development` | `#4CAF50` | Dev workflow |
| `autonomous-ai-agents` | `#7C4DFF` | Coding agents |
| `mlops` | `#FF6D00` | ML operations |
| `productivity` | `#00BFA5` | Workspace tools |
| `devops` | `#FF5252` | Infrastructure |
| `data-science` | `#304FFE` | Data exploration |
| `smart-home` | `#FFAB40` | IoT control |
| `media` | `#F44336` | Media content |
| `email` | `#EA4335` | Email clients |
| `gaming` | `#64DD17` | Games |
| `note-taking` | `#AB47BC` | Notes & wikis |
| `mcp` | `#26A69A` | MCP servers |
| `leisure` | `#FF7043` | Lifestyle |
| `red-teaming` | `#EF5350` | Security testing |
| `apple` | `#A2AAAD` | Apple integrations |
| *(fallback)* | `#78909C` | Unclassified |

Badge styles:
- **Builtin**: `color: #34d399`, `background: rgba(16,185,129,0.15)`, `border: 1px solid rgba(16,185,129,0.3)`
- **Installed**: `color: #60a5fa`, `background: rgba(59,130,246,0.15)`, `border: 1px solid rgba(59,130,246,0.3)`

## Files to Touch

| File | Change |
|------|--------|
| `dashboard/services/status_checker.py` | Add `_parse_bundled_manifest()` and wire into `_list_skills()` |
| `dashboard/static/app.js` | Update `renderSkillsList()` to render badges + category-colored left border |
| `dashboard/static/style.css` | Add `.skill-badge`, category color CSS variables, `border-left` on `.skill-card` |
