# Open question: how the live board should be ordered

Status as of 2026-10-29. **Unresolved — Zane thinks there is a better way.**
Nothing in `app.js` has been changed; it still ships the football-style margin tiers.

## Where it stands

The app currently sorts Live by `margin tier (ceil(margin/3)) -> least time left -> margin`.
Zane's objection: basketball is a game of runs, so margin tiers churn constantly, and a
3-point game early outranks a 5-point game late, which is wrong.

Three schemes were measured. All numbers come from 499 real game timelines polled every
15s (~80,000 live moments), in `calibration/`.

| scheme | cards move / poll | notes |
|---|---|---|
| current margin tiers | 22.6% | baseline |
| score ratio, bands 96/90/77 | 15.2% | buries recoverable early deficits in the bottom band |
| ratio + time-based floor | 13.1% | satisfies both of Zane's examples |
| same, Band 3 split in two | 16.0% | evener board, one more boundary to cross |

Hysteresis (requiring a boundary to be cleared by a margin before the card moves) takes
any of these to roughly 6-7%. On a log scale the guard is proportional, which is the
right shape: tight where games are crowded, loose where they are spread out.

## The tension that has not been resolved

Zane's two requirements pull in opposite directions:

- "a late 5-point game should beat an early 1-point game" -> tolerance must GROW with time
- "an early 10-point deficit is not dead"                 -> tolerance must SHRINK with time

The score ratio `r = min/max = (T-m)/(T+m)` does the first and fails the second.
`z = margin / sqrt(minutes left)` does the second and fails the first. Naive combinations
(`min`, `avg`) produce non-monotonic bands, because whichever measure is more generous
wins and which one that is flips mid-game.

## Things worth remembering

- `logit(r) = ln(min_score / margin)`. The log version of the ratio is just the trailing
  team's score divided by the deficit. The hand-tuned 96/90/77 bands are almost exactly
  even steps on that log scale.
- The ratio SATURATES: late in a game everything crowds into the 90s (last-10-min median
  is 87.7%), so evenly spaced percentages discriminate finely early, where it matters
  least, and barely at all late, where it matters most.
- Two different surfaces were measured and they are not the same question:
  P(final margin within 5) and P(the trailing team wins). "Still in doubt" and "worth
  watching right now" genuinely diverge - a 3-point game with a minute left is ~85%
  decided but maximally watchable.
- No win-probability-based measure will ever demote a 3-2 game at tipoff, because it
  really is a coin flip. That case is better handled by the existing "just tipped" rule
  that parks the opening minutes at the bottom.
- A tie should be scored as a 1-point margin (`max(margin,1)`), not frozen at its previous
  value. Stateless, and it avoids 2-2 inheriting a 2-0 reading and ranking below 4-2.

## Data

- `calibration/games.json`   3,237 completed D1 games, Jan-Mar 2026, with closing lines
- `calibration/timelines.json` 499 full score timelines (every score change, with clock)
- `calibration/pull_*.py`     how they were pulled
- `calibration/split.py`, `analyze9.py` the last two analyses run
