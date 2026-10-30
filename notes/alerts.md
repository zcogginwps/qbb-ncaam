# The flashing alerts

Settled 2026-10-30.

```
Close game  : within 5, under 3:00 left
Upset alert : favorite by more than 6 trailing, under 10:00 left
```

## Measure these in REAL time, not game time

This is the trap. Sampling every 15s of *game clock* says a close-game rule "fires on 21%
of games" - but that is a per-game lifetime rate, not what is on screen. The number that
decides whether a colour is wallpaper is **what share of the live board is lit at a given
instant**, which needs wall-clock stamps (ESPN puts one on every play).

A college game takes a median of **122 real minutes** for 40 minutes of play. The last
2:00 of game clock is **10.5%** of the broadcast, not the 5% a game-clock count implies.

Share of the live board flashing at any instant:

| rule | close alone | with upset alerts |
|---|---|---|
| within 3, under 2:00 (the original guess) | 2.5% | 4.8% |
| **within 5, under 3:00** | **4.5%** | **6.6%** |
| within 6, under 5:00 | 7.6% | 9.3% |

At within 3 / under 2:00 only **one** card flashed on a 20-game night, which is too thin
to be doing any work. The current rule puts ~2.6 cards on a 40-game board. Upset alert
sits at 2.75% on its own, so the two flashing tiers are balanced against each other.
A single flash lasts a median of ~4.7 real minutes.

## Shot clocks instead of minutes: tested, rejected

The idea: a minute late contains more basketball than a minute mid-game, because fouling
compresses possessions, so the reach curve should taper on possessions rather than on the
clock.

**The premise is true.** Scoring plays per game-minute, in close games:

| when | scoring plays / game-minute |
|---|---|
| first half | 8.0 |
| 10-5 left | 7.4 |
| 2:00-1:00 left | 9.6 |
| 1:00-0:30 left | 16.0 |
| last 0:30 | 57.0 |

**But the conclusion does not follow**, for two reasons.

1. Most of that inflation is **free throws** - every made foul shot is its own scoring
   event. The extra possessions are *purchased* by putting the leading team on the line.
2. The comeback odds, which already absorb all of that, collapse anyway. From 5 points
   down: **12.1%** with 3:00 left, **7.2%** at 2:00, **3.2%** at 1:00, **3.6%** at 0:30.
   Six shot clocks' worth of time is a real chance; two is not.

Also worth noting: shot clocks are just `seconds / 30`, a linear rescale of minutes. On its
own it changes nothing but constants. It would only differ by modelling the late
inflation - and the late inflation is exactly the part that does not help.

## The reach curve is already doing this correctly

Comeback odds along the Band 1 boundary (A between 0.9 and 1.1) are close to flat from the
midpoint of the game onward - 12.1% with 15-10 left, 11.6% with 10-5 left, 11.6% under
2:00. The first half sits higher (26.9%), which is deliberate: early games get the benefit
of the doubt.

For contrast, the same margin at different times is a completely different game:

| margin | 1st half | 10-5 left | under 2:00 |
|---|---|---|---|
| 3 | 38.4% | 32.9% | 15.6% |
| 5 | 33.5% | 19.8% | **5.6%** |
| 8 | 33.9% | 12.9% | 1.5% |
| 10 | 18.1% | 7.3% | 0.2% |

So "make 5 points always band 1" would file a 5.6% game beside a 33.5% one. It stays
band 2 late - but it still **flashes as a close game**, because the flash is about what is
worth watching right now and the band is about how reachable the game is. Two different
jobs, which is why they use different rules.
