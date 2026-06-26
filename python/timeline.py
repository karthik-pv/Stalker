"""Timeline rendering: draw a 24-hour activity timeline PNG."""

from datetime import datetime

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
from matplotlib.patches import Rectangle

from config import IST


def render_timeline(sessions: list, day: datetime, output_path: str):
    """Render a 24-hour timeline PNG with colored segments for each session."""
    fig, ax = plt.subplots(figsize=(24, 4), dpi=100)

    # Background
    ax.set_xlim(0, 24)
    ax.set_ylim(0, 1)
    ax.set_facecolor("#1a1a2e")

    # Hour grid lines and labels
    for h in range(25):
        ax.axvline(x=h, color="#333355", linewidth=0.5, zorder=1)
        label = f"{h:02d}:00" if h < 24 else "24:00"
        ax.text(h, -0.08, label, ha="center", va="top", fontsize=8, color="#aaaaaa")

    # Sort sessions by created_at ascending so that when segments overlap,
    # the activity with the latest created_at is drawn last (on top).
    def _created_at_key(session):
        raw = session.get("created_at")
        if raw:
            return datetime.fromisoformat(raw.replace("Z", "+00:00"))
        return datetime.min

    sorted_sessions = sorted(sessions, key=_created_at_key)

    # Draw each session as a colored segment
    for session in sorted_sessions:
        activity = session.get("activities")
        if not activity:
            continue

        color = activity.get("color", "#888888")
        display_name = activity.get("display_name", "Unknown")
        started_at = datetime.fromisoformat(
            session["started_at"].replace("Z", "+00:00")
        ).astimezone(IST)
        ended_at_raw = session.get("ended_at")

        start_hour = (
            started_at.hour + started_at.minute / 60.0 + started_at.second / 3600.0
        )

        # If the session started on a previous day, clamp start to midnight (0.0)
        # so only the portion overlapping this day is drawn.
        if started_at.date() < day.date():
            start_hour = 0.0

        if ended_at_raw:
            ended_at = datetime.fromisoformat(
                ended_at_raw.replace("Z", "+00:00")
            ).astimezone(IST)
        else:
            ended_at = datetime.now(IST)

        end_hour = ended_at.hour + ended_at.minute / 60.0 + ended_at.second / 3600.0

        # Handle sessions that span midnight (cap at 24)
        if end_hour < start_hour:
            end_hour = 24.0
        end_hour = min(end_hour, 24.0)

        duration = end_hour - start_hour
        if duration <= 0:
            continue

        # Draw the segment
        rect = Rectangle(
            (start_hour, 0.25),
            duration,
            0.5,
            facecolor=color,
            edgecolor="white",
            linewidth=0.5,
            alpha=0.85,
            zorder=2,
        )
        ax.add_patch(rect)

        # Label inside segment if wide enough
        if duration > 0.4:
            ax.text(
                start_hour + duration / 2,
                0.5,
                display_name,
                ha="center",
                va="center",
                fontsize=7,
                color="white",
                fontweight="bold",
                zorder=3,
            )

        # Show description if present
        desc = session.get("description")
        if desc and duration > 0.8:
            ax.text(
                start_hour + duration / 2,
                0.35,
                desc[:30],
                ha="center",
                va="center",
                fontsize=5,
                color="#dddddd",
                zorder=3,
            )

    # Title
    date_str = day.strftime("%Y-%m-%d")
    ax.set_title(
        f"Daily Activity Report — {date_str}",
        fontsize=16,
        color="white",
        pad=15,
    )

    # Legend
    seen_colors = {}
    for s in sessions:
        act = s.get("activities")
        if act:
            code = act.get("code")
            if code and code not in seen_colors:
                seen_colors[code] = (
                    act.get("color", "#888"),
                    act.get("display_name", "Unknown"),
                )

    if seen_colors:
        handles = [
            mpatches.Patch(color=color, label=name)
            for color, name in seen_colors.values()
        ]
        ax.legend(
            handles=handles,
            loc="upper left",
            bbox_to_anchor=(0, 1.15),
            ncol=len(handles),
            fontsize=8,
        )

    ax.set_yticks([])
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.spines["bottom"].set_visible(False)
    ax.spines["left"].set_visible(False)

    plt.tight_layout()
    plt.savefig(output_path, bbox_inches="tight", facecolor="#1a1a2e")
    plt.close()
    print(f"Timeline saved to {output_path}")
