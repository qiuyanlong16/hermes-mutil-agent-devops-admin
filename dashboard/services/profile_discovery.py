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
