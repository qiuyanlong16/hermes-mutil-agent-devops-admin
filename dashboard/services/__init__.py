from pathlib import Path
from .profile_discovery import ProfileDiscovery
from .status_checker import StatusChecker
from .process_control import ProcessControl
from .log_streamer import LogStreamer

HERMES_PROFILES_DIR = Path.home() / ".hermes" / "profiles"

discovery = ProfileDiscovery(HERMES_PROFILES_DIR)
status = StatusChecker(HERMES_PROFILES_DIR)
control = ProcessControl()
log_streamer = LogStreamer(HERMES_PROFILES_DIR)
