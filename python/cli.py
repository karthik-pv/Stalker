"""CLI helpers: interactive date prompt."""

from datetime import datetime

from config import IST


def prompt_for_day() -> datetime:
    """Ask the user whether to analyze today or a specific date."""
    today = datetime.now(IST)
    today_str = today.strftime("%d-%m-%Y")
    print(f"Analyze for today ({today_str})? [Y/n]: ", end="", flush=True)
    choice = input().strip().lower()

    if choice == "" or choice == "y" or choice == "yes":
        return today

    while True:
        print("Enter date (dd-mm-yyyy): ", end="", flush=True)
        date_input = input().strip()
        try:
            day = datetime.strptime(date_input, "%d-%m-%Y").replace(tzinfo=IST)
            return day
        except ValueError:
            print("Invalid format. Please use dd-mm-yyyy, e.g. 24-06-2026.")
