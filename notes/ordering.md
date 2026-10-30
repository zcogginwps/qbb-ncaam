# How the live board is ordered

Settled 2026-10-30. Implemented in `app.js` (`reachOf` / `reachRatio` / `bandOf`).

## The rule

```
reach = min( max(total/7, 6),  10,  1.5 * minutesLeft + 2.5 )
A     = margin / reach
bands = A <= 1.0  |  <= 2.0  |  <= 3.2  |  beyond
```

Live games sort: **starred -> band -> least time left -> margin.**

One override on top: **a game inside 5 points is always band 1**, whatever the clock says
(`ALWAYS_REACH_MARGIN`). Zane's call. The measured comeback odds do not support it - five
down is a 19.8% game with 10-5 minutes left and a 5.6% one inside the last two minutes -
but a five-point game late is worth looking at even when it is probably decided, and this
is an ordering, not a prediction. It costs little: band 1 goes from 62.9% of the board to
65.0%, its comeback rate from 33.4% to 32.5%, and the board actually settles slightly
(3.4% -> 3.2% of polls move a card, sampled in real time). The override also bypasses the
slack, so such a game can never be stuck a poll behind in band 2.

Known sharp edge: late in a game the 5/6 line is a cliff. With 18 seconds left, 5 points
is band 1 and 6 points is band 3.

"Reach" is how big a deficit is still within reach *at this moment*, and it is a curve:

- **early**, before many points are on the board, close has to mean closer (`total/7`);
- **through the middle**, anything under ~10 is in reach whatever the clock says;
- **at the end**, the clock takes over: ~1.5 points per minute left, plus a possession.

A band only changes once the game clears the line by 10% (`BAND_SLACK`), so one basket
either side of a boundary cannot make a card jump back and forth.

## Why this shape

What a margin means depends entirely on when it happens, and the two obvious single
measures each get half of it right:

- the score ratio `min/max` ranks a late 5-point game above an early 1-point game, which
  is correct, but it also buries recoverable early deficits, and it **saturates** - late in
  a game everything crowds into the 90s;
- `margin / sqrt(minutes left)` forgives early deficits correctly but demotes tight
  finishes, which are the most watchable thing on the board.

They disagree in the middle, and no single formula of the form `ratio - penalty` can
settle it. The pair that proves it: 9 points at halftime (ratio 0.769) versus 12 points
with 10 minutes left (ratio 0.795). The ratio ranks the 12-pointer higher and a clock
penalty is dormant in both, so no threshold and no multiplier separates them.

The fix was to stop subtracting and let all three ingredients define `reach` instead.

## Measured on 499 real game timelines, polled every 15s

| band | share of board | trailing team wins | ends within 5 |
|---|---|---|---|
| 1 | 64.7% | 33.6% | 40.0% |
| 2 | 25.4% | 11.5% | 18.1% |
| 3 |  7.5% |  1.7% |  4.0% |
| 4 |  2.3% |  0.4% |  0.4% |

Band 1 deliberately holds about two thirds. Most basketball games genuinely are close; the
band still sheds the ones that are not, and inside it the sort by time left does the real
work - a game can only still be in band 1 late because reach has tapered, which means it
is genuinely tight.

**Churn** (share of polls on which a card moves): football-style margin tiers **22.6%** ->
this scheme **6.9%** -> with 10% slack **4.4%**.

| moment | reach | band 1 | band 2 | band 3 |
|---|---|---|---|---|
| 5 min in | 6.0 | within 6 | within 12 | within 19 |
| halftime | 9.9 | within 9 | within 19 | within 31 |
| 10 min left | 10.0 | within 10 | within 20 | within 32 |
| 2 min left | 5.5 | within 5 | within 11 | within 17 |
| 1 min left | 4.0 | within 4 | within 8 | within 12 |

## Notes for later

- Overtime reads the overtime clock (`minutesLeft`), not `secondsLeft`, which returns 0
  once regulation is over and would collapse reach to a single possession.
- A tie counts as half a point of margin, so it never divides to zero and still sorts
  above a one-point game.
- `bandState` is in memory only. After a reload a game starts from its true band, which is
  where the hysteresis would have settled anyway.
- The band is computed once per render, not inside `compareGames`, because the comparator
  runs many times per sort and the band is sticky.
- Rejected along the way, with numbers, if this is ever revisited: evenly spaced ratio
  bands (saturate), log-spaced ratio bands (same ordering, better spacing, still saturate),
  `margin/sqrt(time)` alone (demotes tight finishes), `min()` of two measures
  (non-monotonic - whichever measure is more generous wins, and which one that is flips
  mid-game), and tighter cuts putting band 1 at ~33% (rejected by Zane: most games are
  close, and the broad band has the same filtering effect).

## Data

`calibration/` (gitignored): 3,237 completed games with closing lines, 499 full score
timelines, and the scripts that pulled them.
