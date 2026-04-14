# Hermes Agents Dashboard - Design Spec

## 2026-04-14-hermes-dashboard-design.md

## Problem

Multiple Hermes agent profiles (product-manager, project-manager, test-manager) each run as independent `hermes gateway run` processes. Managing them requires opening separate terminal windows and manually tracking each one's status. No central visibility into agent health, logs, or ability to restart from a single interface.

## Constraints

- `.hermes/` directory is **read-only** — any write operations must be communicated to the user explicitly
- Must auto-discover new profiles when added to `~/.hermes/profiles/`
- Each profile is launched via `hermes -p <profile-name> gateway run`
- Users receive Feishu notifications — dashboard is complementary, not a replacement

## Architecture

### Technology Stack
- **Backend**: FastAPI (Python)
- **Frontend**: HTMX + Tailwind CSS (no build step)
- **Real-time**: Server-Sent Events (SSE) for log streaming
- **Port**: 8765 (configurable)

### Components

#### 1. Profile Discovery Service
- Scans `~/.hermes/profiles/` every 5 seconds
- Returns list of profile names
- Compares against known profiles to detect additions/removals

#### 2. Status Detection (Hybrid)
- **Primary**: Read `gateway_state.json` for PID, state, platform connections
- **Verification**: `os.kill(pid, 0)` to confirm process is alive
- **Fallback**: If JSON is stale or process dead, mark as "stopped"

#### 3. Process Control
- **Start**: `subprocess.Popen(["hermes", "-p", profile, "gateway", "run"])` — detached from dashboard
- **Stop**: Send SIGTERM to PID from `gateway.pid`, then verify termination
- **Restart**: Stop → wait → Start
- All control goes through `hermes -p <profile>` CLI commands, never directly manipulating `.hermes` files

#### 4. Log Streaming
- Reads from `~/.hermes/profiles/<name>/logs/{gateway,agent,errors}.log`
- **SSE endpoint**: `tail -f` equivalent using file position tracking
- **Recent endpoint**: GET last N lines for initial load
- Log type selectable per card: gateway.log (default), agent.log, errors.log

#### 5. Open Terminal
- POST endpoint spawns `xdg-open` or system terminal command
- Opens a new terminal window running `hermes -p <profile> gateway run`
- Uses `gnome-terminal`, `konsole`, or `xterm` based on availability, fallback to `xdg-open`

### API Design

```
GET  /api/agents                    → List all discovered agents with status
POST /api/agents/{name}/start       → Start agent gateway
POST /api/agents/{name}/stop        → Stop agent gateway (SIGTERM)
POST /api/agents/{name}/restart     → Restart agent gateway
POST /api/agents/{name}/open-terminal → Open system terminal for agent
GET  /api/logs/{name}/recent        → Last 100 lines of specified log
GET  /api/logs/{name}/stream        → SSE stream of live log updates
```

### UI Layout

```
┌──────────────────────────────────────────────────────────────┐
│  Hermes Agents Dashboard                          [Refresh]  │
├──────────────────┬───────────────────────────────────────────┤
│                  │  Logs: [gateway.log ▼]  [Clear]          │
│  Agent Cards     │                                           │
│  ┌────────────┐  │  ┌─────────────────────────────────────┐  │
│  │product-mgr │  │  │ [2026-04-14 15:06:54] INFO ...      │  │
│  │ qwen3.5    │  │  │ [2026-04-14 15:06:54] INFO ...      │  │
│  │ PID: 43647 │  │  │ [2026-04-14 15:06:54] INFO ...      │  │
│  │ running    │  │  │ ...                                  │  │
│  │ feishu ✓   │  │  │                                      │  │
│  │ [Start]    │  │  │                                      │  │
│  │ [Restart]  │  │  │                                      │  │
│  │ [Terminal] │  │  │                                      │  │
│  └────────────┘  │  │                                      │  │
│  ┌────────────┐  │  │                                      │  │
│  │project-mgr │  │  │                                      │  │
│  │ qwen3.5    │  │  │                                      │  │
│  │ ...        │  │  │                                      │  │
│  └────────────┘  │  │                                      │  │
│  ┌────────────┐  │  │                                      │  │
│  │test-manager│  │  │                                      │  │
│  │ MiniMax    │  │  │                                      │  │
│  │ ...        │  │  │                                      │  │
│  └────────────┘  │  │                                      │  │
│                  │  └─────────────────────────────────────┘  │
└──────────────────┴───────────────────────────────────────────┘
```

### File Structure

```
devops-mutil-agents/
├── dashboard/
│   ├── app.py                 # FastAPI application (entry point)
│   ├── services/
│   │   ├── __init__.py
│   │   ├── profile_discovery.py   # Scan profiles directory
│   │   ├── status_checker.py      # Read state + verify process
│   │   ├── process_control.py     # Start/stop/restart via CLI
│   │   └── log_streamer.py        # SSE log streaming
│   ├── templates/
│   │   ├── index.html             # Main dashboard layout
│   │   ├── agent_card.html        # Single agent card fragment
│   │   └── log_panel.html         # Log display area fragment
│   └── static/
│       ├── style.css              # Tailwind + custom styles
│       └── app.js                 # HTMX event handlers, SSE setup
├── docs/superpowers/specs/
│   └── 2026-04-14-hermes-dashboard-design.md
└── pyproject.toml                 # Dependencies (fastapi, uvicorn, jinja2)
```

### Error Handling
- If hermes CLI is not found: show clear error on dashboard
- If process fails to start: capture stderr and display in dashboard
- If log file doesn't exist: show "no logs yet" instead of 500
- SSE reconnect: automatic client-side retry with exponential backoff

### Security
- Dashboard binds to `127.0.0.1:8765` by default (localhost only)
- No authentication — assumed to run on trusted local machine
- All commands use `hermes -p` with whitelisted profile names from filesystem scan

### Auto-Discovery
- Background task runs every 5 seconds scanning `~/.hermes/profiles/`
- New profiles appear automatically in the agent card list
- No configuration file to maintain — the dashboard is stateless
