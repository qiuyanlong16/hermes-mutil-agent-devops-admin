# Hermes Agents Dashboard

A lightweight web operations panel for managing multiple isolated [Hermes](https://github.com/hermes) agent profiles.

<img width="1344" height="292" alt="图片" src="https://github.com/user-attachments/assets/f5f70732-8ed3-4e1c-a54f-037a2fd04554" />


## Features

- **Real-time monitoring** — live status (running/stopped), PID, model info, and active agent count for each profile
- **Main agent support** — the root `~/.hermes/` agent is auto-detected and displayed with a "MAIN" badge
- **Process control** — start, stop, restart agents or open a system terminal per profile
- **Live log streaming** — Server-Sent Events (SSE) based real-time log viewer with tab switching between log types
- **Auto-discovery** — scans `~/.hermes/` (main agent) and `~/.hermes/profiles/` (sub-agents) on each poll
- **Zero external dependencies** — pure CSS + vanilla JS, no CDN, no build step
- **Dark ops-panel theme** — adaptive large-screen layout with responsive breakpoints (1920px / 2560px)

## Tech Stack

- **Backend:** FastAPI + Uvicorn
- **Frontend:** Pure CSS + Vanilla JS (no frameworks)
- **Templating:** Jinja2
- **Real-time:** Server-Sent Events (SSE)

## Prerequisites

- Python 3.11+
- Hermes CLI installed (`hermes` command available in PATH)
- Agent profiles configured under `~/.hermes/profiles/`

## Quick Start

```bash
cd dashboard

# Install dependencies
pip install -e .

# Run the server
uvicorn app:app --host 127.0.0.1 --port 8765
```

Open http://127.0.0.1:8765 in your browser.

## Project Structure

```
dashboard/
├── app.py                     # FastAPI application, all routes
├── static/
│   ├── app.js                 # Frontend logic (SSE, polling, actions)
│   └── style.css              # All styles (dark ops panel theme)
├── templates/
│   ├── index.html             # Main dashboard layout
│   ├── agent_card.html        # Single agent card component
│   └── agent_cards.html       # Agent list fragment (for polling refresh)
├── services/
│   ├── __init__.py            # Singleton instances
│   ├── profile_discovery.py   # Scan ~/.hermes/profiles/
│   ├── status_checker.py      # Read gateway_state.json, verify PID
│   ├── process_control.py     # Start/stop/restart agents
│   └── log_streamer.py        # SSE log streaming
└── pyproject.toml
```

## API Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/` | Dashboard page |
| `GET` | `/api/agents` | Agent list fragment (for polling) |
| `POST` | `/api/agents/{name}/start` | Start agent gateway |
| `POST` | `/api/agents/{name}/stop` | Stop agent gateway (SIGTERM) |
| `POST` | `/api/agents/{name}/restart` | Stop then start |
| `POST` | `/api/agents/{name}/open-terminal` | Open system terminal for agent |
| `GET` | `/api/logs/{name}/recent` | Get recent log lines |
| `GET` | `/api/logs/{name}/stream` | SSE stream for live logs |

## Status Detection

Hybrid approach combining `gateway_state.json` state with `os.kill(pid, 0)` process verification for accuracy.

## License

MIT
