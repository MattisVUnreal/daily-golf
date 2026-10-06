# ⛳ Hole of the Day

A daily mini-golf game for the browser. Everyone gets the same hole each day, picked from the date (UTC). Sink it, share your score Wordle-style, and keep your streak going.

Phone first (portrait), also works on PC. It's a static site: plain HTML/JS, no server and no build step. Physics is [Planck.js](https://github.com/piqnt/planck.js) (Box2D), vendored in `js/vendor/`.

## Play

- Drag back from the ball (slingshot) to aim and set power, then let go.
- Each hole has a par from 2 to 5. Water, pits and open edges cost +1 stroke and put the ball back where it was. A round stops at 10 strokes.
- Obstacles: walls, bumpers, kickers, sand, ice, water, moving walls, spinning bars, portals, one-way gates and boost pads.

## Daily mode

- Hole #1 was on 6 Oct 2026. The hole number is days since launch + 1, and the hole changes at midnight UTC.
- There are 60 hand-made holes, and the schedule runs in a 9-week cycle. Within each week the holes get harder from Monday (easiest) to the weekend (hardest), and the overall level rises slowly from week to week. After 9 weeks the cycle repeats with the holes mirrored. A cycle has 63 days, so 3 holes appear a second time, mirrored, at least 3 weeks apart.
- Your first finished round each day is your official score. After that you can replay just for fun.
- Streak rewards at 3, 7, 14, 30 and 100 days unlock ball skins and trails.
- Also included: stats, a calendar, practice on holes you've played, and offline play. Everything is saved in `localStorage`.

## Run locally

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

The service worker only runs over http(s), so opening `index.html` as a file works but won't install offline mode.

## Deploy to GitHub Pages

Settings → Pages → *Deploy from a branch* → pick the branch and `/ (root)`. Everything uses relative paths, so it works from a project subpath.

When you change any game file, bump `VERSION` in `sw.js` so returning players get the update. Players see the new version on their next visit after that.

## Files

| Path | What it is |
|---|---|
| `js/holes.js` | The 60 holes (compact data format documented at the top) |
| `js/physics.js` | Course builder + simulation (shared with the tools) |
| `js/render.js` | Canvas renderer, particles, ball skins & trails |
| `js/audio.js` | WebAudio sound effects (no sound files) |
| `js/daily.js` | Schedule, scoring names, save data, streaks, stats |
| `js/main.js` | Game flow, input, menus |
| `sw.js` | Offline cache |

## Level tools (dev only)

These need Node, and the browser ones need Playwright.

- `node tools/solve.js [from] [to] [--mirror]` brute-forces shots with the real physics. It reports the best score it finds and the hole-in-one rate, and flags unsolvable holes.
- `node tools/human.js [from] [to]` simulates a decent player with aiming noise. Its average is a rough guide for setting par.
- `tools/preview.html` shows every hole as a thumbnail. `node tools/shot.js 0 10 out.png` screenshots them.
- `tools/playtest.js`, `tools/uitest.js` and `tools/hazardtest.js` are headless smoke tests. Serve the folder on port 8123 first.
