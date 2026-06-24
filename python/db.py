"""Database access: fetch activity sessions for a given day."""

from datetime import datetime, timedelta

from config import IST, supabase


def fetch_sessions(day: datetime) -> list:
    """Fetch all activity sessions for the given day (IST), joined with activity info."""
    day_start = day.replace(hour=0, minute=0, second=0, microsecond=0, tzinfo=IST)
    day_end = day_start + timedelta(days=1)

    response = (
        supabase.table("activity_sessions")
        .select("*, activities(*)")
        .gte("started_at", day_start.isoformat())
        .lt("started_at", day_end.isoformat())
        .execute()
    )

    return response.data
