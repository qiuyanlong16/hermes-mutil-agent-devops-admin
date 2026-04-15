import json
import os
import shutil
import signal
import subprocess
import time
from pathlib import Path

from .profile_discovery import HERMES_DIR


class ProcessControl:
    """Start/stop/restart Hermes agents via CLI."""

    def _resolve_dir(self, profile_name: str, is_main: bool = False) -> Path:
        if is_main or profile_name == "__main__":
            return HERMES_DIR
        return Path.home() / ".hermes" / "profiles" / profile_name

    def start(self, profile_name: str, is_main: bool = False) -> dict:
        """Start agent gateway as detached process."""
        try:
            if is_main or profile_name == "__main__":
                cmd = ["hermes", "gateway", "run"]
            else:
                cmd = ["hermes", "-p", profile_name, "gateway", "run"]
            subprocess.Popen(
                cmd,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                start_new_session=True,
            )
            label = profile_name if not is_main else "main"
            return {"success": True, "message": f"Started {label}"}
        except Exception as e:
            return {"success": False, "message": str(e)}

    def stop(self, profile_name: str, is_main: bool = False) -> dict:
        """Send SIGTERM to gateway process."""
        profile_dir = self._resolve_dir(profile_name, is_main)
        label = profile_name if not is_main else "main"

        # Try profile gateway.pid first (sub-agents)
        pid_file = profile_dir / "gateway.pid"
        pid = None

        if pid_file.exists():
            try:
                with open(pid_file) as f:
                    data = json.load(f)
                pid = data.get("pid")
            except Exception:
                pass

        # Fallback: read gateway_state.json (main agent & profiles without gateway.pid)
        if not pid:
            state_file = profile_dir / "gateway_state.json"
            if state_file.exists():
                try:
                    with open(state_file) as f:
                        state = json.load(f)
                    pid = state.get("pid")
                except Exception:
                    pass

        if not pid:
            return {"success": False, "message": "No PID found"}

        try:
            os.kill(pid, signal.SIGTERM)
            for _ in range(20):
                time.sleep(0.5)
                try:
                    os.kill(pid, 0)
                except (OSError, ProcessLookupError):
                    return {"success": True, "message": f"Stopped {label}"}
            return {"success": False, "message": "Process did not stop in time"}
        except ProcessLookupError:
            return {"success": True, "message": "Process already stopped"}
        except Exception as e:
            return {"success": False, "message": str(e)}

    def restart(self, profile_name: str, is_main: bool = False) -> dict:
        """Stop then start."""
        self.stop(profile_name, is_main)
        time.sleep(1)
        return self.start(profile_name, is_main)

    def open_terminal(self, profile_name: str, is_main: bool = False) -> dict:
        """Open a new system terminal running the agent."""
        if is_main or profile_name == "__main__":
            cmd = "hermes gateway run"
        else:
            cmd = f"hermes -p {profile_name} gateway run"
    def open_db(self, profile_name: str, is_main: bool = False) -> dict:
        """Open state.db in sqlitebrowser (Linux only)."""
        import platform
        if platform.system() == "Windows":
            return {"success": False, "message": "Not available on Windows"}
        db_path = self._resolve_dir(profile_name, is_main) / "state.db"
        if not db_path.exists():
            return {"success": False, "message": "state.db not found"}
        if not shutil.which("sqlitebrowser"):
            return {"success": False, "message": "sqlitebrowser not installed. Please install it: sudo apt install sqlitebrowser"}
        try:
            subprocess.Popen(["sqlitebrowser", str(db_path)])
            label = profile_name if not is_main else "main"
            return {"success": True, "message": f"Opened database for {label}"}
        except Exception as e:
            return {"success": False, "message": str(e)}

        terminals = [
            ["gnome-terminal", "--", "bash", "-c", cmd],
            ["konsole", "-e", "bash", "-c", cmd],
            ["xterm", "-e", "bash", "-c", cmd],
            ["alacritty", "-e", "bash", "-c", cmd],
        ]
        for term in terminals:
            if shutil.which(term[0]):
                try:
                    subprocess.Popen(term)
                    label = profile_name if not is_main else "main"
                    return {"success": True, "message": f"Opened terminal for {label}"}
                except Exception as e:
                    return {"success": False, "message": str(e)}
        return {"success": False, "message": "No supported terminal emulator found"}
