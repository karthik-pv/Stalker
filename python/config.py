"""Shared configuration: env loading, constants, and Supabase client."""

import os
import sys
from datetime import timedelta, timezone
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client

IST = timezone(timedelta(hours=5, minutes=30))


def _resolve_env_path() -> Path | None:
    """Locate .env next to the frozen exe, otherwise at the project root."""
    if getattr(sys, "frozen", False):
        candidates = [Path(sys.executable).parent / ".env"]
    else:
        candidates = [Path(__file__).resolve().parent.parent / ".env"]
    for c in candidates:
        if c.exists():
            return c
    return None


load_dotenv(_resolve_env_path())

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SECRET_KEY = os.getenv("DB_SECRET_KEY")
DISCORD_WEBHOOK_URL = os.getenv("DISCORD_WEBHOOK_URL")

if not SUPABASE_URL or not SUPABASE_SECRET_KEY:
    print("Missing SUPABASE_URL or DB_SECRET_KEY in .env")
    sys.exit(1)

supabase = create_client(SUPABASE_URL, SUPABASE_SECRET_KEY)
