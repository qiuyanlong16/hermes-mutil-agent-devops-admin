import json
import os
import shutil
import signal
import subprocess
import time
from pathlib import Path


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
        pid_file = Path.home() / ".hermes" / "profiles" / profile_name / "gateway.pid"
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
        for term in terminals:
            if shutil.which(term[0]):
                try:
                    subprocess.Popen(term)
                    return {"success": True, "message": f"Opened terminal for {profile_name}"}
                except Exception as e:
                    return {"success": False, "message": str(e)}
        return {"success": False, "message": "No supported terminal emulator found"}
