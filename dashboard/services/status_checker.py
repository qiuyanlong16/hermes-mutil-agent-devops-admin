import json
import os
import re
import time
from pathlib import Path

from .profile_discovery import HERMES_DIR


class StatusChecker:
    """Reads gateway_state.json and verifies process is alive."""

    def __init__(self, hermes_dir: Path, profiles_dir: Path):
        self._hermes_dir = hermes_dir
        self._profiles_dir = profiles_dir

    def _resolve_dir(self, profile_name: str, is_main: bool = False) -> Path:
        """Resolve directory for a profile or the main agent."""
        if is_main or profile_name == "__main__":
            return self._hermes_dir
        return self._profiles_dir / profile_name

    def _parse_soul(self, profile_dir: Path) -> str:
        """Extract a one-line soul summary from SOUL.md."""
        soul_file = profile_dir / "SOUL.md"
        if not soul_file.exists():
            return ""
        text = soul_file.read_text(errors="replace")
        # Look for identity section: "## 核心身份", "## 身份", "## Core Identity", etc.
        soul_patterns = ["## 核心身份", "## 身份", "## Core Identity", "## Role", "## 角色"]
        target_section = None
        for pattern in soul_patterns:
            if pattern in text:
                target_section = pattern
                break
        if not target_section:
            # Fallback: use the first H2 section
            for line in text.splitlines():
                stripped = line.strip()
                if stripped.startswith("## ") and not stripped.startswith("## SOUL"):
                    target_section = stripped.rstrip()
                    break
        if not target_section:
            return ""

        in_section = False
        for line in text.splitlines():
            if line.strip().startswith(target_section):
                in_section = True
                continue
            if in_section:
                stripped = line.strip()
                if not stripped:
                    continue
                if stripped.startswith("##"):
                    break
                if stripped.startswith("###"):
                    continue
                cleaned = re.sub(r"\*\*([^*]+)\*\*", r"\1", stripped)
                cleaned = re.sub(r"\*([^*]+)\*", r"\1", cleaned)
                cleaned = re.sub(r"^[-*]\s*", "", cleaned)
                cleaned = re.sub(r"^[\d]+[\.\)]\s*", "", cleaned)
                if len(cleaned) > 60:
                    cleaned = cleaned[:57] + "..."
                return cleaned
        return ""

    def _readable_channel_name(self, platform: str, name: str, ch_type: str) -> str:
        """Convert an opaque channel ID to a readable display name with platform prefix."""
        # Platform display names
        platform_labels = {
            "feishu": "飞书",
            "weixin": "微信",
            "wecom": "企业微信",
            "telegram": "Telegram",
            "discord": "Discord",
            "slack": "Slack",
            "dingtalk": "钉钉",
            "whatsapp": "WhatsApp",
            "signal": "Signal",
        }
        prefix = platform_labels.get(platform, platform)

        # If name is already readable, just prepend platform
        if name and not name.startswith("oc_") and "@" not in name:
            return f"{prefix}·{name}"

        # Opaque ID — generate readable fallback
        if ch_type == "dm":
            return f"{prefix}·私聊"
        if ch_type == "group":
            return f"{prefix}·群聊"
        return f"{prefix}·{name}"

    def _count_channels(self, profile_dir: Path) -> dict:
        """Count connected channels from channel_directory.json."""
        ch_file = profile_dir / "channel_directory.json"
        if not ch_file.exists():
            return {"total": 0, "names": []}
        try:
            with open(ch_file) as f:
                data = json.load(f)
        except Exception:
            return {"total": 0, "names": []}
        platforms = data.get("platforms", {})
        names = []
        total = 0
        for platform, channels in platforms.items():
            if channels:
                for ch in channels:
                    name = ch.get("name", "")
                    ch_type = ch.get("type", "")
                    display = self._readable_channel_name(platform, name, ch_type)
                    names.append(display)
                    total += 1
        return {"total": total, "names": names}

    def _count_dir_items(self, profile_dir: Path, dirname: str) -> int:
        """Count items in a subdirectory (skip hidden and json meta files)."""
        d = profile_dir / dirname
        if not d.exists():
            return 0
        count = 0
        for item in d.iterdir():
            if item.name.startswith("."):
                continue
            if item.is_file() and item.suffix == ".json" and item.stem == "sessions":
                continue  # skip sessions.json meta
            count += 1
        return count

    def _parse_uptime(self, profile_dir: Path) -> str:
        """Calculate uptime from gateway_state.json start_time or file mtime."""
        state_file = profile_dir / "gateway_state.json"
        if not state_file.exists():
            return ""
        try:
            with open(state_file) as f:
                state = json.load(f)
            start = state.get("start_time")
            if start:
                elapsed = time.monotonic() - start
                if elapsed > 0:
                    hours = int(elapsed // 3600)
                    minutes = int((elapsed % 3600) // 60)
                    if hours > 0:
                        return f"{hours}h {minutes}m"
                    return f"{minutes}m"
            # Fallback: use file modification time
            mtime = state_file.stat().st_mtime
            elapsed = time.time() - mtime
            hours = int(elapsed // 3600)
            minutes = int((elapsed % 3600) // 60)
            if hours > 0:
                return f"{hours}h {minutes}m"
            return f"{minutes}m"
        except Exception:
            return ""

    def _parse_model_provider(self, config_file: Path) -> str:
        """Extract model provider from config.yaml."""
        if not config_file.exists():
            return ""
        for line in config_file.read_text().splitlines():
            stripped = line.strip()
            if stripped.startswith("provider:"):
                return stripped.split(":", 1)[1].strip()
        return ""

    def get_status(self, profile: dict) -> dict:
        """Return status dict for a profile dict with {name, is_main}."""
        name = profile["name"]
        is_main = profile.get("is_main", False)
        profile_dir = self._resolve_dir(name, is_main)

        state_file = profile_dir / "gateway_state.json"
        config_file = profile_dir / "config.yaml"

        # Read config.yaml for model + provider
        model = "unknown"
        provider = ""
        if config_file.exists():
            for line in config_file.read_text().splitlines():
                stripped = line.strip()
                if stripped.startswith("default:") and ":" in stripped:
                    model = stripped.split(":", 1)[1].strip()
                if stripped.startswith("provider:"):
                    val = stripped.split(":", 1)[1].strip().strip("'\"")
                    if val:
                        provider = val

        # Base result
        result = {
            "name": name if not is_main else "main",
            "pid": None,
            "model": model,
            "provider": provider,
            "running": False,
            "state": "stopped",
            "feishu_connected": False,
            "active_agents": 0,
            "is_main": is_main,
            "soul": self._parse_soul(profile_dir),
            "channels": {"total": 0, "names": []},
            "sessions": 0,
            "skills": 0,
            "uptime": "",
        }

        # Count channels, sessions, skills (always available)
        result["channels"] = self._count_channels(profile_dir)
        result["sessions"] = self._count_dir_items(profile_dir, "sessions")
        result["skills"] = self._count_dir_items(profile_dir, "skills")

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

            result["pid"] = pid
            result["running"] = process_alive
            result["state"] = gateway_state if process_alive else "stopped"
            result["feishu_connected"] = feishu_connected
            result["active_agents"] = active_agents

            if process_alive:
                result["uptime"] = self._parse_uptime(profile_dir)

        return result
