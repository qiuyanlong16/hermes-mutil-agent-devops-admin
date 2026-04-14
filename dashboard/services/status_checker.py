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
