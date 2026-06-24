"""Discord delivery: send the timeline PNG via webhook, then clean up."""

import os
from datetime import datetime
from pathlib import Path

import requests

from config import DISCORD_WEBHOOK_URL


def send_to_discord(image_path: str, day: datetime, sessions: list):
    """Send the PNG to Discord via webhook, along with any activity descriptions.

    On successful upload the local image file is deleted from disk.
    """
    if not DISCORD_WEBHOOK_URL:
        print("DISCORD_WEBHOOK_URL not set — skipping Discord delivery.")
        return

    date_str = day.strftime("%Y-%m-%d")
    message = f"Daily Activity Report - {date_str}"

    # Collect descriptions
    descriptions = []
    for s in sessions:
        desc = s.get("description")
        act = s.get("activities")
        if desc and act:
            name = act.get("display_name", "Unknown")
            descriptions.append(f"{name} - {desc}")

    if descriptions:
        message += "\n" + "\n".join(descriptions)

    sent = False
    try:
        with open(image_path, "rb") as f:
            response = requests.post(
                DISCORD_WEBHOOK_URL,
                data={"content": message},
                files={"file": (Path(image_path).name, f, "image/png")},
            )
        if response.status_code in (200, 204):
            print("Sent to Discord successfully.")
            sent = True
        else:
            print(f"Discord upload failed: {response.status_code} {response.text}")
    except Exception as e:
        print(f"Discord upload error: {e}")

    # Delete the local image only after a successful send
    if sent:
        try:
            os.remove(image_path)
            print(f"Deleted local image: {image_path}")
        except OSError as e:
            print(f"Could not delete local image: {e}")
