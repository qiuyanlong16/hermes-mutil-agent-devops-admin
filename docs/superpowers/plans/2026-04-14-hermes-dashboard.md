# Hermes Agents Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a FastAPI + HTMX web dashboard to monitor, control, and stream logs from multiple Hermes agent profiles.

**Architecture:** FastAPI backend with 4 service modules (profile discovery, status checking, process control, log streaming), 3 API route groups (agents, logs, terminal), and HTMX frontend with SSE-based real-time log streaming. All hermes interactions go through `hermes -p <profile>` CLI — never write to `.hermes/`.

**Tech Stack:** Python 3.12, FastAPI, uvicorn, Jinja2, HTMX, Tailwind CSS (CDN), SSE

---

### File Map

| File | Responsibility |
|------|---------------|
| `dashboard/pyproject.toml` | Project metadata + dependencies (fastapi, uvicorn, jinja2) |
| `dashboard/app.py` | FastAPI app, routes, app startup |
| `dashboard/services/__init__.py` | Package init, singleton instances |
| `dashboard/services/profile_discovery.py` | Scan `~/.hermes/profiles/` for profile names |
| `dashboard/services/status_checker.py` | Read `gateway_state.json` + verify PID alive |
| `dashboard/services/process_control.py` | Start/stop/restart agents via `hermes -p` CLI |
| `dashboard/services/log_streamer.py` | Read recent logs + SSE streaming with file position tracking |
| `dashboard/templates/index.html` | Full dashboard page (sidebar + log panel) |
| `dashboard/static/style.css` | Custom CSS (Tailwind loaded via CDN) |
| `dashboard/static/app.js` | SSE client, agent selection, log tab switching, auto-scroll |

---

### Task 1: Project Skeleton

- [ ] **Step 1: Create project directory structure**

Create all directories needed:

```bash
mkdir -p dashboard/services dashboard/templates dashboard/static
```

- [ ] **Step 2: Write `pyproject.toml`**

`dashboard/pyproject.toml`:

```toml
[project]
name = "hermes-dashboard"
version = "0.1.0"
description = "Web dashboard for managing multiple Hermes agent profiles"
requires-python = ">=3.11"
dependencies = [
    "fastapi>=0.115.0",
    "uvicorn>=0.32.0",
    "jinja2>=3.1.0",
]
```

- [ ] **Step 3: Install dependencies**

```bash
cd dashboard && pip install -e . 2>&1 | tail -5
```

Expected: Successfully installed fastapi, uvicorn, jinja2 and dependencies.

- [ ] **Step 4: Verify imports work**

```bash
python3 -c "import fastapi; import uvicorn; import jinja2; print('OK')"
```

Expected output: `OK`

- [ ] **Step 5: Commit skeleton**

```bash
git add dashboard/pyproject.toml
git commit -m "chore: add hermes dashboard project skeleton"
```

---

### Task 2: Service Layer

All 4 service modules in this task — they form a cohesive layer with clear internal boundaries.

- [ ] **Step 1: Write `services/__init__.py`**

`dashboard/services/__init__.py`:

```python
from .profile_discovery import ProfileDiscovery
from .status_checker import StatusChecker
from .process_control import ProcessControl
from .log_streamer import LogStreamer

HERMES_PROFILES_DIR = Path.home() / ".hermes" / "profiles"

discovery = ProfileDiscovery(HERMES_PROFILES_DIR)
status = StatusChecker(HERMES_PROFILES_DIR)
control = ProcessControl()
log_streamer = LogStreamer(HERMES_PROFILES_DIR)
```

- [ ] **Step 2: Write `services/profile_discovery.py`**

`dashboard/services/profile_discovery.py`:

```python
from pathlib import Path

class ProfileDiscovery:
    """Scans ~/.hermes/profiles/ directory to discover agent profiles."""

    def __init__(self, profiles_dir: Path):
        self._profiles_dir = profiles_dir

    def list_profiles(self) -> list[str]:
        """Return sorted list of profile directory names."""
        if not self._profiles_dir.exists():
            return []
        return sorted(
            d.name for d in self._profiles_dir.iterdir() if d.is_dir()
        )
```

- [ ] **Step 3: Write `services/status_checker.py`**

`dashboard/services/status_checker.py`:

```python
import json
import os
from pathlib import Path

class StatusChecker:
    """Reads gateway_state.json and verifies process is alive."""

    def __init__(self, profiles_dir: Path):
        self._profiles_dir = profiles_dir

    def get_status(self, profile_name: str) -> dict:
        """Return status dict for a single profile."""
        profile_dir = self._profiles_dir / profile_name
        state_file = profile_dir / "gateway_state.json"
        pid_file = profile_dir / "gateway.pid"
        config_file = profile_dir / "config.yaml"

        # Read config.yaml for model info (simple parse, no pyyaml needed)
        model = "unknown"
        if config_file.exists():
            for line in config_file.read_text().splitlines():
                if line.startswith("  default:"):
                    model = line.split(":", 1)[1].strip()
                    break

        # Try to read gateway state
        if state_file.exists():
            with open(state_file) as f:
                state = json.load(f)
            pid = state.get("pid")
            gateway_state = state.get("gateway_state", "unknown")
            platforms = state.get("platforms", {})
            active_agents = state.get("active_agents", 0)

            # Verify process is alive
            process_alive = False
            if pid:
                try:
                    os.kill(pid, 0)
                    process_alive = True
                except (OSError, ProcessLookupError):
                    process_alive = False

            feishu_connected = platforms.get("feishu", {}).get("state") == "connected"

            return {
                "name": profile_name,
                "pid": pid,
                "model": model,
                "running": process_alive,
                "state": gateway_state if process_alive else "stopped",
                "feishu_connected": feishu_connected,
                "active_agents": active_agents,
            }

        # No state file — profile exists but never started
        return {
            "name": profile_name,
            "pid": None,
            "model": model,
            "running": False,
            "state": "stopped",
            "feishu_connected": False,
            "active_agents": 0,
        }
```

- [ ] **Step 4: Write `services/process_control.py`**

`dashboard/services/process_control.py`:

```python
import os
import signal
import subprocess
import time

class ProcessControl:
    """Start/stop/restart Hermes agents via CLI — never writes to .hermes/."""

    def start(self, profile_name: str) -> dict:
        """Start agent gateway as detached process."""
        try:
            subprocess.Popen(
                ["hermes", "-p", profile_name, "gateway", "run"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                start_new_session=True,
            )
            return {"success": True, "message": f"Started {profile_name}"}
        except Exception as e:
            return {"success": False, "message": str(e)}

    def stop(self, profile_name: str) -> dict:
        """Send SIGTERM to gateway process."""
        pid_file = f"/home/{os.getenv('USER')}/.hermes/profiles/{profile_name}/gateway.pid"
        import json
        try:
            with open(pid_file) as f:
                data = json.load(f)
            pid = data.get("pid")
            if not pid:
                return {"success": False, "message": "No PID found"}
            os.kill(pid, signal.SIGTERM)
            # Wait up to 10s for process to exit
            for _ in range(20):
                time.sleep(0.5)
                try:
                    os.kill(pid, 0)
                except (OSError, ProcessLookupError):
                    return {"success": True, "message": f"Stopped {profile_name}"}
            return {"success": False, "message": "Process did not stop in time"}
        except ProcessLookupError:
            return {"success": True, "message": "Process already stopped"}
        except Exception as e:
            return {"success": False, "message": str(e)}

    def restart(self, profile_name: str) -> dict:
        """Stop then start."""
        self.stop(profile_name)
        time.sleep(1)
        return self.start(profile_name)

    def open_terminal(self, profile_name: str) -> dict:
        """Open a new system terminal running the agent."""
        cmd = f"hermes -p {profile_name} gateway run"
        terminals = [
            ["gnome-terminal", "--", "bash", "-c", cmd],
            ["konsole", "-e", "bash", "-c", cmd],
            ["xterm", "-e", "bash", "-c", cmd],
            ["alacritty", "-e", "bash", "-c", cmd],
        ]
        import shutil
        for term in terminals:
            if shutil.which(term[0]):
                try:
                    subprocess.Popen(term)
                    return {"success": True, "message": f"Opened terminal for {profile_name}"}
                except Exception as e:
                    return {"success": False, "message": str(e)}
        # Fallback: try xdg-open with a terminal:// URI (may not work)
        return {"success": False, "message": "No supported terminal emulator found"}
```

- [ ] **Step 5: Write `services/log_streamer.py`**

`dashboard/services/log_streamer.py`:

```python
import os
import time
from pathlib import Path

VALID_LOG_TYPES = ["gateway.log", "agent.log", "errors.log"]

class LogStreamer:
    """Read recent log lines and stream new lines via SSE."""

    def __init__(self, profiles_dir: Path):
        self._profiles_dir = profiles_dir
        self._file_positions: dict[str, int] = {}

    def get_recent_lines(self, profile_name: str, log_type: str, n_lines: int = 100) -> str:
        """Return last N lines from the log file."""
        log_file = self._profiles_dir / profile_name / "logs" / log_type
        if not log_file.exists():
            return ""
        text = log_file.read_text(errors="replace")
        lines = text.splitlines()
        return "\n".join(lines[-n_lines:]) if lines else ""

    def stream_new_lines(self, profile_name: str, log_type: str):
        """Generator that yields new log lines as SSE messages."""
        key = f"{profile_name}:{log_type}"
        log_file = self._profiles_dir / profile_name / "logs" / log_type

        if not log_file.exists():
            yield f"event: error\ndata: Log file not found: {log_type}\n\n"
            return

        # Initialize position at end of file
        if key not in self._file_positions:
            self._file_positions[key] = log_file.stat().st_size

        try:
            with open(log_file) as f:
                while True:
                    # Check if file was truncated/rotated
                    try:
                        current_size = log_file.stat().st_size
                    except FileNotFoundError:
                        yield f"event: error\ndata: Log file removed\n\n"
                        return

                    if current_size < self._file_positions.get(key, 0):
                        f.seek(0)
                        self._file_positions[key] = 0

                    f.seek(self._file_positions.get(key, 0))
                    new_lines = f.readlines()
                    if new_lines:
                        self._file_positions[key] = f.tell()
                        for line in new_lines:
                            yield f"event: log\ndata: {line.rstrip()}\n\n"

                    time.sleep(0.3)
        except GeneratorExit:
            self._file_positions.pop(key, None)
        except Exception as e:
            self._file_positions.pop(key, None)
            yield f"event: error\ndata: {e}\n\n"
```

- [ ] **Step 6: Commit service layer**

```bash
git add dashboard/services/
git commit -m "feat: add dashboard service layer (discovery, status, control, log streaming)"
```

---

### Task 3: API Routes

- [ ] **Step 1: Write `dashboard/app.py`**

`dashboard/app.py`:

```python
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from starlette.responses import JSONResponse

from services import discovery, status, control, log_streamer
from services.log_streamer import VALID_LOG_TYPES

DASHBOARD_DIR = Path(__file__).parent
templates = Jinja2Templates(directory=str(DASHBOARD_DIR / "templates"))


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield

app = FastAPI(title="Hermes Agents Dashboard", lifespan=lifespan)
app.mount("/static", StaticFiles(directory=str(DASHBOARD_DIR / "static")), name="static")


# ── Pages ──────────────────────────────────────────────────────────────────

@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    """Main dashboard page."""
    profiles = discovery.list_profiles()
    agents = [status.get_status(p) for p in profiles]
    return templates.TemplateResponse("index.html", {
        "request": request,
        "agents": agents,
        "log_types": VALID_LOG_TYPES,
    })


@app.get("/api/agents")
async def list_agents(request: Request):
    """GET all agents with status (for HTMX polling refresh)."""
    profiles = discovery.list_profiles()
    agents = [status.get_status(p) for p in profiles]
    # Return partial HTML for HTMX swap
    return templates.TemplateResponse("agent_cards.html", {
        "request": request,
        "agents": agents,
        "log_types": VALID_LOG_TYPES,
    })


# ── Agent Control ─────────────────────────────────────────────────────────

@app.post("/api/agents/{profile_name}/start")
async def start_agent(profile_name: str):
    profiles = discovery.list_profiles()
    if profile_name not in profiles:
        return JSONResponse({"error": "Profile not found"}, status_code=404)
    result = control.start(profile_name)
    return JSONResponse(result)


@app.post("/api/agents/{profile_name}/stop")
async def stop_agent(profile_name: str):
    profiles = discovery.list_profiles()
    if profile_name not in profiles:
        return JSONResponse({"error": "Profile not found"}, status_code=404)
    result = control.stop(profile_name)
    return JSONResponse(result)


@app.post("/api/agents/{profile_name}/restart")
async def restart_agent(profile_name: str):
    profiles = discovery.list_profiles()
    if profile_name not in profiles:
        return JSONResponse({"error": "Profile not found"}, status_code=404)
    result = control.restart(profile_name)
    return JSONResponse(result)


@app.post("/api/agents/{profile_name}/open-terminal")
async def open_terminal(profile_name: str):
    profiles = discovery.list_profiles()
    if profile_name not in profiles:
        return JSONResponse({"error": "Profile not found"}, status_code=404)
    result = control.open_terminal(profile_name)
    return JSONResponse(result)


# ── Log Endpoints ──────────────────────────────────────────────────────────

@app.get("/api/logs/{profile_name}/recent")
async def get_recent_logs(profile_name: str, log_type: str = "gateway.log"):
    profiles = discovery.list_profiles()
    if profile_name not in profiles:
        return JSONResponse({"error": "Profile not found"}, status_code=404)
    if log_type not in VALID_LOG_TYPES:
        return JSONResponse({"error": "Invalid log type"}, status_code=400)
    lines = log_streamer.get_recent_lines(profile_name, log_type)
    return JSONResponse({"lines": lines})


@app.get("/api/logs/{profile_name}/stream")
async def stream_logs(profile_name: str, log_type: str = "gateway.log"):
    """SSE endpoint for live log streaming."""
    profiles = discovery.list_profiles()
    if profile_name not in profiles:
        return JSONResponse({"error": "Profile not found"}, status_code=404)
    if log_type not in VALID_LOG_TYPES:
        return JSONResponse({"error": "Invalid log type"}, status_code=400)

    return StreamingResponse(
        log_streamer.stream_new_lines(profile_name, log_type),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
```

- [ ] **Step 2: Verify app loads without errors**

```bash
cd dashboard && python3 -c "from app import app; print('App loaded OK')"
```

Expected output: `App loaded OK`

- [ ] **Step 3: Commit routes**

```bash
git add dashboard/app.py
git commit -m "feat: add FastAPI routes (agents CRUD, log streaming, terminal)"
```

---

### Task 4: HTML Templates

- [ ] **Step 1: Write `templates/index.html`**

`dashboard/templates/index.html`:

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Hermes Agents Dashboard</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script src="https://unpkg.com/htmx.org@2.0.4"></script>
    <link rel="stylesheet" href="/static/style.css">
</head>
<body class="bg-gray-950 text-gray-100 h-screen overflow-hidden">
    <!-- Header -->
    <header class="bg-gray-900 border-b border-gray-800 px-6 py-3 flex items-center justify-between">
        <h1 class="text-lg font-semibold text-white">Hermes Agents Dashboard</h1>
        <div class="flex items-center gap-3">
            <span id="agent-count" class="text-sm text-gray-400">{{ agents|length }} agents</span>
            <button hx-get="/api/agents" hx-target="#agent-list" hx-swap="innerHTML"
                    class="px-3 py-1 text-sm bg-gray-800 hover:bg-gray-700 rounded border border-gray-700 transition">
                Refresh
            </button>
        </div>
    </header>

    <div class="flex h-[calc(100vh-52px)]">
        <!-- Sidebar: Agent Cards -->
        <aside class="w-80 bg-gray-900 border-r border-gray-800 overflow-y-auto p-4">
            <div id="agent-list" hx-get="/api/agents" hx-trigger="every 3s" hx-swap="innerHTML">
                {% for agent in agents %}
                {% include "agent_card.html" %}
                {% endfor %}
            </div>
        </aside>

        <!-- Main: Log Panel -->
        <main class="flex-1 flex flex-col overflow-hidden">
            <!-- Log Controls -->
            <div id="log-controls" class="hidden bg-gray-900 border-b border-gray-800 px-4 py-2 flex items-center gap-3">
                <span id="log-agent-name" class="text-sm font-medium text-white"></span>
                <div class="flex gap-1" id="log-tabs">
                    {% for lt in log_types %}
                    <button onclick="selectLogTab('{{ lt }}')"
                            class="log-tab px-3 py-1 text-xs rounded transition
                                   {% if lt == 'gateway.log' %}bg-blue-600 text-white{% else %}bg-gray-800 text-gray-400 hover:bg-gray-700{% endif %}"
                            data-log-type="{{ lt }}">
                        {{ lt }}
                    </button>
                    {% endfor %}
                </div>
                <button onclick="clearLogs()" class="ml-auto text-xs text-gray-500 hover:text-gray-300">Clear</button>
            </div>

            <!-- Log Output -->
            <div id="log-output" class="flex-1 overflow-auto p-4 font-mono text-sm text-gray-300 bg-gray-950">
                <div class="text-gray-600 italic">Select an agent to view logs...</div>
            </div>
        </main>
    </div>

    <script src="/static/app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Write `templates/agent_card.html`**

`dashboard/templates/agent_card.html`:

```html
<div class="agent-card mb-3 bg-gray-800 rounded-lg border border-gray-700 p-4 cursor-pointer transition hover:border-gray-600"
     onclick="selectAgent('{{ agent.name }}')">
    <div class="flex items-center justify-between mb-2">
        <span class="font-medium text-white">{{ agent.name }}</span>
        <span class="status-badge px-2 py-0.5 text-xs rounded-full
                     {% if agent.running %}bg-green-900 text-green-300{% else %}bg-red-900 text-red-300{% endif %}">
            {% if agent.running %}running{% else %}stopped{% endif %}
        </span>
    </div>
    <div class="text-xs text-gray-400 space-y-1">
        <div>Model: <span class="text-gray-300">{{ agent.model }}</span></div>
        {% if agent.pid %}
        <div>PID: <span class="text-gray-300">{{ agent.pid }}</span></div>
        {% endif %}
        <div>Agents active: <span class="text-gray-300">{{ agent.active_agents }}</span></div>
        {% if agent.feishu_connected %}
        <div class="text-green-400">Feishu connected</div>
        {% else %}
        <div class="text-gray-500">Feishu not connected</div>
        {% endif %}
    </div>
    <div class="flex gap-2 mt-3 pt-3 border-t border-gray-700" onclick="event.stopPropagation()">
        {% if not agent.running %}
        <button hx-post="/api/agents/{{ agent.name }}/start"
                hx-on::after-request="refreshAgentList()"
                class="flex-1 px-2 py-1 text-xs bg-green-700 hover:bg-green-600 rounded transition">
            Start
        </button>
        {% else %}
        <button hx-post="/api/agents/{{ agent.name }}/stop"
                hx-on::after-request="refreshAgentList()"
                class="flex-1 px-2 py-1 text-xs bg-yellow-700 hover:bg-yellow-600 rounded transition">
            Stop
        </button>
        <button hx-post="/api/agents/{{ agent.name }}/restart"
                hx-on::after-request="refreshAgentList()"
                class="flex-1 px-2 py-1 text-xs bg-blue-700 hover:bg-blue-600 rounded transition">
            Restart
        </button>
        {% endif %}
        <button hx-post="/api/agents/{{ agent.name }}/open-terminal"
                class="flex-1 px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 rounded transition">
            Terminal
        </button>
    </div>
</div>
```

- [ ] **Step 3: Start server and verify HTML renders**

```bash
cd dashboard && python3 -m uvicorn app:app --host 127.0.0.1 --port 8765 &
sleep 2
curl -s http://127.0.0.1:8765/ | head -5
```

Expected: HTML output starting with `<!DOCTYPE html>`

- [ ] **Step 4: Commit templates**

```bash
git add dashboard/templates/
git commit -m "feat: add dashboard HTML templates (index, agent cards)"
```

---

### Task 5: Frontend JavaScript + CSS + Final Testing

- [ ] **Step 1: Write `static/app.js`**

`dashboard/static/app.js`:

```javascript
let currentAgent = null;
let currentLogType = "gateway.log";
let eventSource = null;

function selectAgent(name) {
    // Remove highlight from all cards
    document.querySelectorAll('.agent-card').forEach(card => {
        card.classList.remove('border-blue-500', 'ring-1', 'ring-blue-500');
    });

    // Highlight selected card
    event.currentTarget.classList.add('border-blue-500', 'ring-1', 'ring-blue-500');

    // Show log controls
    document.getElementById('log-controls').classList.remove('hidden');
    document.getElementById('log-controls').classList.add('flex');
    document.getElementById('log-agent-name').textContent = name;

    // Switch SSE stream
    currentAgent = name;
    startLogStream();
}

function selectLogTab(logType) {
    currentLogType = logType;

    // Update tab styles
    document.querySelectorAll('.log-tab').forEach(tab => {
        if (tab.dataset.logType === logType) {
            tab.classList.remove('bg-gray-800', 'text-gray-400');
            tab.classList.add('bg-blue-600', 'text-white');
        } else {
            tab.classList.remove('bg-blue-600', 'text-white');
            tab.classList.add('bg-gray-800', 'text-gray-400');
        }
    });

    // Restart SSE with new log type
    startLogStream();
}

function startLogStream() {
    if (!currentAgent) return;

    // Close existing connection
    if (eventSource) {
        eventSource.close();
    }

    // Clear log output
    const output = document.getElementById('log-output');
    output.innerHTML = '';

    // Load recent lines first
    fetch(`/api/logs/${currentAgent}/recent?log_type=${currentLogType}`)
        .then(r => r.json())
        .then(data => {
            if (data.lines) {
                output.innerHTML = formatLogLines(data.lines);
                output.scrollTop = output.scrollHeight;
            }
        })
        .catch(() => {});

    // Open SSE connection
    eventSource = new EventSource(
        `/api/logs/${currentAgent}/stream?log_type=${currentLogType}`
    );

    eventSource.addEventListener('log', (e) => {
        const output = document.getElementById('log-output');
        const div = document.createElement('div');
        div.className = 'log-line whitespace-pre';
        div.textContent = e.data;
        output.appendChild(div);

        // Auto-scroll if near bottom
        if (output.scrollHeight - output.scrollTop - output.clientHeight < 100) {
            output.scrollTop = output.scrollHeight;
        }

        // Limit displayed lines to prevent memory issues
        while (output.children.length > 2000) {
            output.removeChild(output.firstChild);
        }
    });

    eventSource.addEventListener('error', (e) => {
        const output = document.getElementById('log-output');
        const div = document.createElement('div');
        div.className = 'text-red-400';
        div.textContent = e.data;
        output.appendChild(div);
    });
}

function clearLogs() {
    document.getElementById('log-output').innerHTML = '';
}

function formatLogLines(text) {
    return text.split('\n').map(line => {
        return `<div class="log-line whitespace-pre">${escapeHtml(line)}</div>`;
    }).join('');
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function refreshAgentList() {
    // Trigger HTMX to refresh agent list immediately
    const agentList = document.getElementById('agent-list');
    if (agentList) {
        htmx.trigger(agentList, 'htmx:poll');
    }
}

// Re-select agent card after HTMX swap (polling replaces innerHTML)
document.body.addEventListener('htmx:afterSwap', function(evt) {
    if (evt.detail.target.id === 'agent-list' && currentAgent) {
        // Re-highlight the currently selected card
        const cards = document.querySelectorAll('.agent-card');
        cards.forEach(card => {
            const onclick = card.getAttribute('onclick');
            if (onclick && onclick.includes(`'${currentAgent}'`)) {
                card.classList.add('border-blue-500', 'ring-1', 'ring-blue-500');
            }
        });
    }
});
```

- [ ] **Step 2: Write `static/style.css`**

`dashboard/static/style.css`:

```css
/* Custom styles for Hermes Dashboard */

.log-line {
    line-height: 1.5;
}

.log-line:hover {
    background-color: rgba(59, 130, 246, 0.05);
}

/* Smooth scroll for log output */
#log-output {
    scroll-behavior: smooth;
}

/* Card hover effect */
.agent-card:hover {
    transform: translateY(-1px);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
}

/* Status badge pulse for running agents */
.status-badge.bg-green-900 {
    animation: pulse-green 2s ease-in-out infinite;
}

@keyframes pulse-green {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.7; }
}

/* Scrollbar styling */
::-webkit-scrollbar {
    width: 8px;
    height: 8px;
}

::-webkit-scrollbar-track {
    background: #1a1a2e;
}

::-webkit-scrollbar-thumb {
    background: #4a4a6a;
    border-radius: 4px;
}

::-webkit-scrollbar-thumb:hover {
    background: #6a6a8a;
}
```

- [ ] **Step 3: Kill existing server if running, restart for testing**

```bash
pkill -f "uvicorn app:app.*8765" 2>/dev/null; sleep 1
cd dashboard && python3 -m uvicorn app:app --host 127.0.0.1 --port 8765 &
sleep 2
echo "Server started"
```

- [ ] **Step 4: Test API endpoints**

```bash
# Test agents list
curl -s http://127.0.0.1:8765/api/agents | python3 -m json.tool 2>/dev/null | head -20

# Test recent logs
curl -s "http://127.0.0.1:8765/api/logs/product-manager/recent?log_type=gateway.log" | python3 -m json.tool 2>/dev/null | head -10

# Test SSE (timeout after 2s)
timeout 2 curl -sN "http://127.0.0.1:8765/api/logs/product-manager/stream?log_type=gateway.log" 2>/dev/null || true
```

Expected:
- `/api/agents` returns HTML with agent cards
- `/api/logs/.../recent` returns JSON with `"lines"` field
- SSE endpoint streams `event: log` lines

- [ ] **Step 5: Test agent control endpoints**

```bash
# Test stop (test-manager is running)
curl -s -X POST http://127.0.0.1:8765/api/agents/test-manager/stop | python3 -m json.tool

# Wait, then verify stopped
sleep 2
curl -s http://127.0.0.1:8765/api/agents | grep -o "test-manager.*running\|test-manager.*stopped"

# Test start
curl -s -X POST http://127.0.0.1:8765/api/agents/test-manager/start | python3 -m json.tool
sleep 2
curl -s http://127.0.0.1:8765/api/agents | grep -o "test-manager.*running\|test-manager.*stopped"
```

Expected: Stop returns success, agent shows stopped. Start returns success, agent shows running.

- [ ] **Step 6: Open in browser for manual UI test**

```bash
echo "Open http://127.0.0.1:8765 in browser"
xdg-open http://127.0.0.1:8765 2>/dev/null || echo "Please open http://127.0.0.1:8765 manually"
```

Verify:
- Page loads with 3 agent cards in sidebar
- Each card shows correct status (running/stopped), model, PID, Feishu state
- Clicking a card shows logs in right panel
- Log tabs (gateway.log, agent.log, errors.log) switch correctly
- Logs stream in real-time
- Start/Stop/Restart buttons work
- Terminal button opens a new terminal window
- Agent list auto-refreshes every 3 seconds

- [ ] **Step 7: Stop the test server**

```bash
pkill -f "uvicorn app:app.*8765" 2>/dev/null
echo "Server stopped"
```

- [ ] **Step 8: Final commit**

```bash
git add dashboard/static/
git commit -m "feat: add frontend (SSE log streaming, agent selection, CSS) and complete dashboard"
```

---

> **End of plan.** Each task produces independently testable software. Task 2 (services) can be tested in isolation via Python REPL. Task 3 (routes) can be tested via curl. Task 4 (templates) verified by server start. Task 5 (frontend) verified in browser.
