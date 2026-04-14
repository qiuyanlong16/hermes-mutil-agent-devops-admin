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
