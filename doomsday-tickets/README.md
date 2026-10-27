# Avengers: Doomsday ticket watcher (Long Island, Dec 17–21)

`doomsday_watch.py` checks public showtime listings for Long Island theaters, then:

- **ranks every showing**: 50% picture/sound format, 30% seat comfort, 20% time of day
- **gives the best showing per day** with seat advice and a direct Fandango buy link
- **alerts you** the first time it runs, when new premium showtimes appear (Dec 19–21 weren't posted as of Oct 27), and when a good showing is close to selling out

## Important: no IMAX in the US for this film

*Dune: Part Three* opens the same day and has US IMAX exclusivity for about three weeks. Even "& IMAX" theaters will show Doomsday on a regular screen. The best screens on Long Island are:

| Rank | Theater | Best format | Why |
|---|---|---|---|
| 1 | AMC Dine-In Huntington Square 12 (East Northport) | **Dolby Cinema** + Prime | Dolby Vision HDR laser, Atmos, dine-in recliners |
| 2 | AMC Stony Brook 17 | **Dolby Cinema** | Same Dolby setup, recliners |
| 3 | Regal Westbury | RPX / InfinityVision, laser | Large premium screen, recliners |
| 3 | Regal Deer Park | RPX / InfinityVision + ScreenX | Same, plus 270° ScreenX |
| 5 | Regal Lynbrook | RPX / InfinityVision | Laser, recliners |
| 6 | Showcase Cinema de Lux Farmingdale, Island 16 (Holtsville) | de Lux PLF | Reserved seating |

The Dolby showings for Dec 17–18 were already marked **almost sold out** on Oct 27. If you want Dolby, book now.

## Run it

Needs Python 3.8+ and nothing else.

```bash
python3 doomsday_watch.py            # top 10 list, writes report.md
python3 doomsday_watch.py --top 25   # longer list
```

`state.json` remembers what it has already seen. Delete it to start fresh.

## Get alerts on your phone

1. Install the free **ntfy** app (iOS/Android) and subscribe to a hard-to-guess topic name, such as `doomsday-li-7f3k9`.
2. Set `NTFY_TOPIC` to that name when you run the script. On macOS and Linux desktops it also shows a desktop notification.
3. Schedule it to run every 4 hours. On macOS or Linux, run `crontab -e` and add:

```cron
0 */4 * * * NTFY_TOPIC=doomsday-li-7f3k9 /usr/bin/python3 /path/to/doomsday-tickets/doomsday_watch.py >/dev/null 2>&1
```

On Windows, use Task Scheduler to run `python doomsday_watch.py` with the same environment variable.

Each run makes 15 small page requests, 3 seconds apart. Keep the schedule to a few runs a day. The listing site is free and public, so please don't hammer it.

## Seat picks by format

- **Dolby Cinema:** rows E–G, dead center. The rooms are steep and Atmos sounds best in the middle third.
- **RPX / InfinityVision / PLF:** center seats, a row or two behind the middle.
- **ScreenX:** dead center in the middle rows. From the edges or the front you lose the side-wall projection.
- **Times:** 5–8 pm shows score highest. Early-morning and after-midnight marathon slots score lowest.

The listings show "almost sold out" but not exact seats. Open the buy link to see the seat map.
