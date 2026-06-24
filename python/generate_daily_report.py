"""
Daily Activity Report Generator

Fetches all activity sessions for a given day from Supabase,
renders a 24-hour timeline PNG, and sends it to Discord via webhook.
"""

import sys
import tempfile
from datetime import datetime
from pathlib import Path

from cli import prompt_for_day
from config import IST  # noqa: F401  (ensures env/client init on import)
from db import fetch_sessions
from discord_client import send_to_discord
from timeline import render_timeline


def _output_dir() -> Path:
    """Where to write the temporary PNG.

    When running as a frozen exe (e.g. from the desktop), use the system
    temp directory so the user's desktop stays clean. When running as a
    script, keep the original `output/` folder behaviour.
    """
    if getattr(sys, "frozen", False):
        return Path(tempfile.gettempdir())
    return Path("output")


def main():
    day = prompt_for_day()

    date_str = day.strftime("%Y_%m_%d")
    output_dir = _output_dir()
    output_dir.mkdir(exist_ok=True)
    output_path = str(output_dir / f"timeline_{date_str}.png")

    print(f"\nFetching sessions for {day.strftime('%Y-%m-%d')}...")
    sessions = fetch_sessions(day)

    if not sessions:
        print("No sessions found for this day.")
        # Still render an empty timeline
        render_timeline([], day, output_path)
    else:
        print(f"Found {len(sessions)} sessions.")
        render_timeline(sessions, day, output_path)

    send_to_discord(output_path, day, sessions)
    print("Done.")


if __name__ == "__main__":
    main()
