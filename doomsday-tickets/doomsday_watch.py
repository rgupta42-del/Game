#!/usr/bin/env python3
"""Avengers: Doomsday ticket watcher for Long Island premium theaters.

Checks public showtime listings (bigscreen.com, which links each showtime to
Fandango) for Dec 17-21, 2026, ranks every showing by screen quality, seat
comfort and time of day, and alerts you when new showtimes appear or when good
ones are about to sell out.

Run it on your own computer, a few times a day at most (see README.md).
Standard library only; Python 3.8+.

    python3 doomsday_watch.py              # check, print ranked report, alert on changes
    python3 doomsday_watch.py --top 15     # longer list
    python3 doomsday_watch.py --html-dir saved_pages/   # parse saved pages, no network
"""

import argparse
import html
import json
import os
import re
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path

MOVIE_ID = "333637"  # bigscreen.com id for Avengers: Doomsday (2026)
DATES = ["2026-12-17", "2026-12-18", "2026-12-19", "2026-12-20", "2026-12-21"]
# One ZIP per area so the 15-mile search circles cover Nassau and western/central Suffolk.
SEARCH_ZIPS = ["11590", "11729", "11790"]  # Westbury, Deer Park, Stony Brook
LISTING_URL = "https://www.bigscreen.com/NowShowing.php"
USER_AGENT = "doomsday-watch/1.0 (personal showtime checker; runs a few times a day)"
REQUEST_GAP_SECONDS = 3

HERE = Path(__file__).resolve().parent
STATE_FILE = HERE / "state.json"
REPORT_FILE = HERE / "report.md"

# Towns the search circles reach that are not on Long Island.
NOT_LONG_ISLAND = {
    "Bronx", "Flushing", "Forest Hills", "Kew Gardens", "Bayside", "Fresh Meadows",
    "New Rochelle", "Jamaica", "Astoria", "Long Island City", "College Point",
    "Whitestone", "Elmhurst", "Rego Park", "Douglaston", "Queens", "Mount Vernon",
    "Yonkers", "Port Chester", "Stamford", "Norwalk", "Bridgeport",
}

# Hand-rated baseline per theater (0-10): building, seats, upkeep, crowd.
# Unlisted theaters get 5 and are scored on the listing's format tags alone.
THEATER_COMFORT = {
    "AMC Dine-In Huntington Square 12": 9,   # Dolby Cinema + Prime, dine-in recliners
    "AMC Stony Brook 17": 8,                 # Dolby + IMAX auditoriums, recliners
    "Regal Westbury": 8,                     # RPX, laser, recliners
    "Regal Deer Park": 8,                    # RPX + ScreenX, laser, recliners
    "Regal Lynbrook": 7,                     # RPX, laser, recliners
    "Showcase Cinema de Lux Farmingdale": 7, # de Lux PLF, reserved seats
    "Regal UA Farmingdale & IMAX": 7,        # laser, recliners (no IMAX for this film)
    "Island 16: Cinema de Lux": 7,           # de Lux PLF + MX4D
    "AMC Dine-In Levittown 10": 7,
    "AMC Roosevelt Field 8": 7,
    "AMC Shore 8": 6,
    "AMC Glen Cove 6": 6,
    "AMC Raceway 10": 5,
    "AMC Fantasy 5": 4,
    "South Bay Cinema": 4,
}

# Picture/sound score for a showing, from the strongest format tag present.
FORMAT_TIERS = [
    ("dolby cinema", 10, "Dolby Cinema"),
    ("imax", 9, "IMAX"),
    ("infinityvision", 8, "InfinityVision"),
    ("rpx", 8, "RPX"),
    ("plf experience", 7, "PLF"),
    ("screenx", 6, "ScreenX"),
    ("4dx", 5, "4DX"),
    ("laser", 4, "Laser"),
    ("digital", 2, "Digital"),
]

SEAT_TIPS = {
    "Dolby Cinema": "Rows E-G dead center; Dolby rooms are steep, so the middle third of the room is ideal for Atmos.",
    "IMAX": "Two-thirds of the way back, dead center, so the screen fills your view without neck strain.",
    "InfinityVision": "Big premium screen: middle of the room, center seats, slightly behind the halfway row.",
    "RPX": "Center seats a row or two behind the middle; RPX sound is tuned for the center of the room.",
    "PLF": "Center seats, about two-thirds back.",
    "ScreenX": "Sit dead center in the middle rows. The side-wall projection is lost from the edges or the front.",
    "4DX": "Any seat moves; center seats get the best view of the screen.",
}
DEFAULT_SEAT_TIP = "Center seats about two-thirds of the way back. Avoid the first three rows."


def fetch_listing(zip_code, date):
    query = urllib.parse.urlencode({
        "movie": MOVIE_ID, "view": "sched", "show": "nearby",
        "zip": zip_code, "showdate": date, "range": "15",
    })
    req = urllib.request.Request(f"{LISTING_URL}?{query}", headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read().decode("utf-8", errors="replace")


ROW_RE = re.compile(r'<tr class="graybar_\d">(.*?)</tr>', re.S)
NAME_RE = re.compile(r'class="theatername_showtimes">([^<]+)</a><br><span class="small">([^<]+)</span>')
DIST_RE = re.compile(r'class="col_distance">([^<]*)<')
TIME_RE = re.compile(r'<a href="([^"]*fandango[^"]*date=(\d{4}-\d{2}-\d{2})\+(\d{2}):(\d{2}))"[^>]*>([^<]+)</a>')
COMMENT_RE = re.compile(r'<span class="showcomment">([^<]*)</span>')


def parse_listing(page):
    """Return one dict per showtime found on a bigscreen schedule page."""
    shows = []
    for row in ROW_RE.findall(page):
        name_match = NAME_RE.search(row)
        if not name_match:
            continue
        theater = html.unescape(name_match.group(1)).strip()
        town = html.unescape(name_match.group(2)).strip()
        dist = DIST_RE.search(row)
        comment = COMMENT_RE.search(row)
        tags = [t.strip() for t in html.unescape(comment.group(1)).split(";")] if comment else []
        tags = [t for t in tags if t]
        for link, date, hh, mm, label in TIME_RE.findall(row):
            shows.append({
                "theater": theater,
                "town": town,
                "distance": dist.group(1).strip() if dist else "",
                "date": date,
                "time": f"{hh}:{mm}",
                "label": label.strip(),
                "tags": tags,
                "link": html.unescape(link),
            })
    return shows


def best_format(tags):
    joined = " ".join(tags).lower()
    for needle, score, name in FORMAT_TIERS:
        if needle in joined:
            return score, name
    return 1, "Standard"


def time_score(date, hhmm):
    """Prefer evening shows; penalize very early and after-midnight shows."""
    hour = int(hhmm[:2])
    weekend = datetime.strptime(date, "%Y-%m-%d").weekday() >= 4  # Fri-Sun
    if hour < 5:        # after-midnight showings are listed under the previous day
        return 0
    if hour < 10:
        return 2
    if 17 <= hour <= 20:
        return 10
    if 12 <= hour < 17:
        return 8 if weekend else 7
    if 10 <= hour < 12:
        return 5
    return 6  # 9-11pm


def score(show):
    fmt_score, fmt_name = best_format(show["tags"])
    tags_lower = [t.lower() for t in show["tags"]]
    comfort = THEATER_COMFORT.get(show["theater"], 5)
    if any("recliner" in t for t in tags_lower):
        comfort += 1
    if any("prime" in t for t in tags_lower):
        comfort += 1
    total = round(fmt_score * 0.5 + min(comfort, 10) * 0.3 + time_score(show["date"], show["time"]) * 0.2, 2)
    show["format"] = fmt_name
    show["score"] = total
    show["almost_sold_out"] = any("sold out" in t for t in tags_lower)
    show["seat_tip"] = SEAT_TIPS.get(fmt_name, DEFAULT_SEAT_TIP)
    return show


def show_key(show):
    return f'{show["theater"]}|{show["date"]}|{show["time"]}|{show["format"]}'


def collect(html_dir=None):
    pages = []
    if html_dir:
        pages = [p.read_text(errors="replace") for p in sorted(Path(html_dir).glob("*.htm*"))]
    else:
        for i, (zip_code, date) in enumerate((z, d) for d in DATES for z in SEARCH_ZIPS):
            if i:
                time.sleep(REQUEST_GAP_SECONDS)
            try:
                pages.append(fetch_listing(zip_code, date))
            except Exception as exc:  # keep going; one bad page should not kill the run
                print(f"warning: could not load {zip_code} {date}: {exc}", file=sys.stderr)
    seen = {}
    for page in pages:
        for show in parse_listing(page):
            if show["town"].split(",")[0].strip() in NOT_LONG_ISLAND:
                continue
            if show["date"] not in DATES:
                continue
            show = score(show)
            seen.setdefault(show_key(show), show)
    return sorted(seen.values(), key=lambda s: (-s["score"], s["date"], s["time"]))


def fmt_show(s):
    day = datetime.strptime(s["date"], "%Y-%m-%d").strftime("%a %b %d")
    flag = "  [ALMOST SOLD OUT]" if s["almost_sold_out"] else ""
    return f'{s["score"]:>5}  {day} {s["label"]:>6}  {s["format"]:<14} {s["theater"]} ({s["town"]}){flag}'


def build_report(shows, new, top):
    lines = [f"# Avengers: Doomsday on Long Island: {len(shows)} showtimes, Dec 17-21",
             f"_Checked {datetime.now():%Y-%m-%d %H:%M}_", ""]
    if new:
        lines += [f"## New since last check ({len(new)})", "```"] + [fmt_show(s) for s in new[:top]] + ["```", ""]
    lines += [f"## Top {top} showings (score = 50% picture, 30% comfort, 20% showtime)", "```"]
    lines += [fmt_show(s) for s in shows[:top]] + ["```", ""]
    lines += ["## Best showing per day"]
    for date in DATES:
        day_shows = [s for s in shows if s["date"] == date and not s["almost_sold_out"]]
        if day_shows:
            b = day_shows[0]
            lines.append(f'- **{date}**: {b["label"]} {b["format"]} at {b["theater"]}. Seats: {b["seat_tip"]} Buy: {b["link"]}')
        else:
            lines.append(f"- **{date}**: nothing listed yet")
    lines += ["", "## Theater ranking (best showing at each)"]
    ranked = {}
    for s in shows:
        ranked.setdefault(s["theater"], s)
    for name, s in ranked.items():
        lines.append(f'- {name} ({s["town"]}): best format {s["format"]}, top score {s["score"]}')
    return "\n".join(lines) + "\n"


def notify(title, message):
    """Push to your phone via ntfy.sh if NTFY_TOPIC is set; else desktop notification if possible."""
    topic = os.environ.get("NTFY_TOPIC")
    if topic:
        req = urllib.request.Request(f"https://ntfy.sh/{topic}", data=message.encode(),
                                     headers={"Title": title, "Priority": "high", "Tags": "film_projector"})
        try:
            urllib.request.urlopen(req, timeout=20)
        except Exception as exc:
            print(f"warning: ntfy push failed: {exc}", file=sys.stderr)
    try:
        if sys.platform == "darwin":
            script = f"display notification {json.dumps(message[:200])} with title {json.dumps(title)}"
            subprocess.run(["osascript", "-e", script], check=False)
        elif sys.platform.startswith("linux") and os.environ.get("DISPLAY"):
            subprocess.run(["notify-send", title, message[:200]], check=False)
    except OSError:
        pass


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--top", type=int, default=10, help="how many showings to list (default 10)")
    ap.add_argument("--min-score", type=float, default=6.5,
                    help="only alert about new showings at or above this score (default 6.5)")
    ap.add_argument("--html-dir", help="parse saved .html pages from this folder instead of fetching")
    args = ap.parse_args()

    shows = collect(args.html_dir)
    if not shows:
        print("No Long Island showtimes found for Dec 17-21 yet (or the listing site could not be reached).")
        return 1

    state = json.loads(STATE_FILE.read_text()) if STATE_FILE.exists() else {"seen": [], "almost_sold_out": []}
    first_run = not state["seen"]
    new = [s for s in shows if show_key(s) not in set(state["seen"])]
    newly_scarce = [s for s in shows if s["almost_sold_out"] and s["score"] >= args.min_score
                    and show_key(s) not in set(state["almost_sold_out"])]

    report = build_report(shows, [] if first_run else new, args.top)
    REPORT_FILE.write_text(report)
    print(report)

    good_new = [s for s in new if s["score"] >= args.min_score]
    if first_run:
        best = shows[0]
        notify("Doomsday tickets are on sale on Long Island",
               f'{len(shows)} showtimes Dec 17-21. Best: {best["format"]} {best["label"]} '
               f'{best["date"][5:]} at {best["theater"]}. {best["link"]}')
    elif good_new:
        top_new = good_new[0]
        notify(f"{len(good_new)} new premium Doomsday showtimes",
               f'Top: {top_new["format"]} {top_new["label"]} {top_new["date"][5:]} at {top_new["theater"]}. {top_new["link"]}')
    if newly_scarce and not first_run:
        s = newly_scarce[0]
        notify("Doomsday showing almost sold out",
               f'{s["format"]} {s["label"]} {s["date"][5:]} at {s["theater"]} ({len(newly_scarce)} total). {s["link"]}')

    state = {"seen": sorted(show_key(s) for s in shows),
             "almost_sold_out": sorted(show_key(s) for s in shows if s["almost_sold_out"]),
             "checked": datetime.now().isoformat(timespec="seconds")}
    STATE_FILE.write_text(json.dumps(state, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
