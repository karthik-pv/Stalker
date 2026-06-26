"""Database access: fetch activity sessions for a given day."""

from datetime import datetime, timedelta

from config import IST, supabase


def fetch_sessions(day: datetime) -> list:
    """Fetch all activity sessions overlapping the given day (IST), joined with activity info.

    This includes:
      - Sessions that started within the day.
      - Sessions that started on a previous day but extend into (or past) this day.
    """
    day_start = day.replace(hour=0, minute=0, second=0, microsecond=0, tzinfo=IST)
    day_end = day_start + timedelta(days=1)

    # Sessions that started within the target day
    resp_in_day = (
        supabase.table("activity_sessions")
        .select("*, activities(*)")
        .gte("started_at", day_start.isoformat())
        .lt("started_at", day_end.isoformat())
        .execute()
    )

    # Sessions that started before the day but overlap into it
    #   (ended_at is NULL  OR  ended_at > day_start)
    resp_cross_day = (
        supabase.table("activity_sessions")
        .select("*, activities(*)")
        .lt("started_at", day_start.isoformat())
        .or_(f"ended_at.is.null,ended_at.gt.{day_start.isoformat()}")
        .execute()
    )

    # Merge, deduplicate by session id (in case of edge conditions)
    merged = {}
    for s in resp_in_day.data + resp_cross_day.data:
        merged[s["id"]] = s

    return list(merged.values())
