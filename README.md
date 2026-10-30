# Quad Box Buddy — NCAAM

A college-basketball scoreboard that **re-sorts the night's games by how worth watching they
are**, and tints cards when something notable is happening. Sibling to the football
[Quad Box Buddy](https://github.com/zcogginwps/upset-alert).

Plain static HTML + CSS + vanilla JS. No build step, no framework, no server — every phone
talks to ESPN's public API directly, so hosting is free and there is nothing to run.

## Files

```
index.html      header, date picker, filter chips, three game sections, Favorite Teams panel
app.js          everything: fetch, parse, rules, sorting, rendering, favorites, polls
style.css       dark theme, card layout, alert/watch styling
manifest.json   PWA metadata
version.json    {"v":"N"} — the self-update mechanism
icons/          icon.svg + PNGs at 512/192/180/32
scripts/bump.sh stamps a new build number into app.js, index.html and version.json
scripts/serve.py local static server for testing (no-cache, so you never debug a stale file)
```

## How it differs from the football app

Basketball is **date-based, not week-based**, so the week dropdown is a date picker driven by
`leagues[0].calendar`, with arrows to step a day either way.

**The thresholds were re-derived from scratch, not ported.** Football's numbers are wrong here:
the median basketball final margin is 9 and the median line is 5.5, so football's "7+ favorite"
bar would have excluded over half the slate. Every rule was calibrated on **3,226 completed D1
games from January–March 2026** (conference play, so the sample is not November buy-game
biased), targeting a fire rate of roughly 1 game in 10–20:

| Tag | Rule | Fires on |
|---|---|---|
| Upset alert | favorite by >6 trailing, under 10:00 left | 9.3% |
| Close game | one possession (within 3), under 2:00 left | ~21% |
| Comeback watch | a lead has shrunk by 15+, now within 5 | 15.3% |
| Blowout watch | line was ≤4, someone is up 20+ | 9.3% |
| Upset (final) | an underdog of more than 6 won | 8.6% (1 in 12) |
| Close call (final) | a favorite of 8+ survived by ≤5 | 5.1% (1 in 20) |
| Blowout win (final) | won by 22+ **and** beat the spread by 18+ | 5.7% (1 in 18) |
| Comeback win (final) | came back from 14+ down, or trailed by 8+ at the half | 6.7% (1 in 15) |

The footer legend is generated from these constants, so the plain-English rules can never
drift away from what the code does.

Two other basketball-specific changes:

- **Runs replace down & distance.** ESPN sends no `situation` object for basketball, so the
  "what's happening right now" line is an unanswered-points run computed from the scores we
  poll. Because polling is every 15s, a run where both teams scored inside one poll is not
  counted — it under-reports rather than inventing.
- **Tournament seeds.** During the NCAA tournament ESPN reuses `curatedRank` to carry the
  seed rather than a poll position, so those render as `(4)` instead of `#4`, and the card
  picks up the round and region from the event note.

## Conference ids

Basketball's ESPN conference ids are **not** football's and they collide — `8` is the Big 12
here but the SEC there; the ACC is `2` here and `1` there. Verified ids:
SEC 23, Big Ten 7, Big 12 8, ACC 2, Big East 4. Everything else rolls up into the "Mid" chip.

## localStorage

GitHub Pages serves both QBB apps from the **same origin**, so localStorage is shared with the
football app. Every key here is prefixed `qbbm_` to keep the two from reading each other's state.

## Deploying

1. `scripts/bump.sh <N>` — stamps the build number into `app.js`, `index.html` and `version.json`.
   **Run this before every single deploy**, or iOS will keep serving the cached build.
2. `git push origin main` — GitHub Pages goes live in 40–90 seconds.
3. Verify by polling `https://<site>/version.json?t=<n>` until the new number appears.

The app fetches `version.json` on every poll and, when the number differs from the running
build, navigates to `?v=<build>` — deliberately *not* `location.reload()`, which the iOS
home-screen app answers from its cached `index.html`.

## Testing

```
python3 scripts/serve.py 8766
```

- `?demo` fakes a mid-evening slate so every alert state can be seen on a non-game day.
  Games ESPN has not priced yet get a synthetic line, so demo works on any date.
- `?demo=shuffle` also nudges scores every 6s to exercise the reorder animation.
- `?date=YYYYMMDD` opens a specific day.
