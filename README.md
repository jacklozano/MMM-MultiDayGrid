# MMM-MultiDayGrid

A Google-Calendar-style multi-day time grid for [MagicMirror²](https://magicmirror.builders).

Unlike renderer-only calendar modules, this one owns its whole stack: it **fetches its own ICS
feeds**, expands recurrences, lays out the grid, and ships its own CSS. It does not depend on the
built-in `calendar` module and needs no patches.

> ### ⚠️ Status: v0.1.0 — contract only, not yet functional
>
> This release contains the **configuration contract, the layout derivation, and this
> documentation**. The fetcher and the renderer are not implemented yet, so installing it will not
> display a calendar. Everything below describes the intended, settled behaviour; it is published
> first so the config surface is fixed before code depends on it.
>
> | Component | State |
> |---|---|
> | Config contract + `lib/derive.js` + tests | ✅ done |
> | Fetcher (`node_helper.js`, `lib/`) | ⬜ next |
> | Renderer (`lib/layout.js`, `lib/grid.js`, CSS) | ⬜ after that |

---

## Install

```bash
cd ~/MagicMirror/modules
git clone https://github.com/jacklozano/MMM-MultiDayGrid
cd MMM-MultiDayGrid
npm install --omit=dev
```

Requires Node `>=22.21.1 <23 || >=24` (same as MagicMirror 2.37). Dependencies: `node-ical`,
`moment-timezone`.

## Minimal example

```js
{
  module: "MMM-MultiDayGrid",
  position: "bottom_left",
  config: {
    calendars: [
      { name: "Home", url: "https://example.com/basic.ics", color: "#00A63F" }
    ]
  }
}
```

Everything else has a default. `width` and `height` are the only geometry you normally set.

---

## Configuration reference

### Sources

| Option | Type | Default | Description |
|---|---|---|---|
| `calendars` | array | **required** | The ICS feeds to display. Maximum 8. Full per-entry reference in [`calendars[]`](#calendars) below. |

### Layout and window

| Option | Type | Default | Description |
|---|---|---|---|
| `days` | number | `3` | Day columns to render. **Range 1–4**; higher values are clamped with a logged warning. See [Hard limits](#hard-limits) for why 4 is the ceiling. |
| `dayIndex` | number | `0` | Which day the grid starts on, relative to today. `0` = today, `-1` = yesterday. |
| `beginHour` | number | `6` | First hour shown, 0–23. |
| `hourLength` | number | `16` | Hours displayed. `beginHour: 6` + `hourLength: 16` → 06:00–22:00. |
| `staticTime` | boolean | `true` | `true` = fixed window. `false` = the window follows the current time. |
| `width` | string \| number | `"100%"` | Any CSS length. A derived value is normal — the reference deployment uses `calc(100vw - 1364px)` to fill the space beside a fixed-width neighbour. |
| `height` | string \| number | `"800px"` | Any CSS length. Drives row height, and therefore font size. |

### Appearance

| Option | Type | Default | Description |
|---|---|---|---|
| `fontScale` | number | `1.0` | Multiplies the derived font size. **The intended knob for viewing distance** — prefer it to overriding `baseFontSize`, because it scales the whole grid consistently. |
| `eventTint` | number | `0.58` | How far each calendar colour is mixed toward white, 0–1. Pastel fills let one fixed dark ink stay legible on every calendar instead of flipping per-colour. Lower it if the blocks glow on a mirror. |
| `inkColor` | string | `"#14161a"` | Text colour inside event blocks. |
| `showHalfHourLines` | boolean | `false` | Half-hour rules. Off by default — the single biggest decluttering win on a glanceable display. |
| `todayStyle` | `"ring"` \| `"fill"` \| `"none"` | `"ring"` | How today's date header is marked. A ring adds no extra colour to the screen. |
| `todayTint` | number | `0.06` | How far today's column is lifted from the background, 0–1. Rendered as white over black, so `0.06` is `#0f0f0f` — a dark grey, not a hue, so it marks "here" without competing with the calendar colours. The tint runs unbroken through the day header, chip bar and grid. `0.03` is near-invisible; `0.12` (`#1f1f1f`) is assertive. |
| `neutralWeekends` | boolean | `true` | `true` renders Sat/Sun headers in the same grey as weekdays. Calendar colours already carry meaning; tinting weekends adds two more that compete. |
| `passedOpacity` | number | `0.4` | Opacity of events that have already ended, 0–1. They recede rather than disappear, so the shape of the day still reads. |

### Behaviour

| Option | Type | Default | Description |
|---|---|---|---|
| `allDayThresholdHours` | number | `23` | A **timed** event at least this long is rendered as an all-day chip instead of a block. Without this, a 00:00–23:59 out-of-office entry fills an entire column to convey one bit of information. |
| `includePastEvents` | boolean | `true` | Keep events that already ended today. Required for a grid — otherwise this morning's entries vanish part-way through the day. |
| `hidePrivate` | boolean | `true` | Skip events marked private. |

### Fetching

| Option | Type | Default | Description |
|---|---|---|---|
| `fetchInterval` | number | `900000` | Default refresh interval in ms (15 min). Per-calendar values override it. |
| `fetchTimeout` | number | `90000` | Per-feed timeout in ms. Feeds are fetched **in parallel**, so one slow feed does not delay the others. |
| `staleAfterMinutes` | number | `90` | How old a feed's data may get before it is named in the corner note. Events are never discarded — see [Behaviour contract](#behaviour-contract). |

### Formatting

Each takes an [`Intl.DateTimeFormat`](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Intl/DateTimeFormat) options object.

| Option | Default | Renders |
|---|---|---|
| `dateHeaderOptions` | `{ weekday: "short", day: "numeric" }` | `Fri 15` |
| `hourIndexOptions` | `{ hour: "numeric" }` | `10 AM` |
| `eventTimeOptions` | `{ hour: "numeric", minute: "2-digit" }` | `9:30 AM` |

Changing `hourIndexOptions` automatically resizes the hour axis — its width is measured from the
labels actually rendered, not hard-coded.

### Advanced

Escape hatches. All default to `"auto"`, meaning derived. Set a number only when the derivation is
genuinely wrong for your display — and consider `fontScale` first.

| Option | Type | Default | Description |
|---|---|---|---|
| `baseFontSize` | number \| `"auto"` | `"auto"` | Root font size in px. Every other size in the grid is an `em` multiple of it. |
| `indexWidth` | number \| `"auto"` | `"auto"` | Hour-axis column width in px. Auto measures the widest rendered label. |
| `minTileWidth` | number \| `"auto"` | `"auto"` | Narrowest an event tile may be squeezed to, in px. |
| `minFontSize` | number | `14` | Legibility floor. **This value determines the minimum board size** — see below. |
| `onUndersize` | `"reduceDays"` \| `"warn"` \| `"error"` | `"reduceDays"` | What to do when the board is too small. `reduceDays` drops `days` until it fits and logs both values; `warn` renders anyway at the floor; `error` renders a notice instead of the grid. |

---

## `calendars[]`

Required. **Maximum 8 entries**, with a warning above 6 — see [Hard limits](#hard-limits).

| Key | Type | Default | Description |
|---|---|---|---|
| `name` | string | required | Display name. Also how the feed is identified in logs and the corner note, so make it unique. |
| `url` | string | required | An **iCal/ICS** URL. See [Getting an ICS URL](#getting-an-ics-url). |
| `color` | string | required | Any CSS colour. Mixed `eventTint` toward white before display, so pick saturated values — pastels collapse into each other after mixing. |
| `hidden` | boolean | `false` | Silence this feed without deleting its config. Filtered server-side; hidden events never reach the browser. |
| `exclude` | array | `[]` | Rules dropping events from this feed. See below. |
| `fetchInterval` | number | inherits | Per-calendar refresh interval in ms. |

### `exclude` rules

```js
exclude: [
  { field: "title",    match: "contains", value: "Declined" },
  { field: "title",    match: "regex",    value: "^Home" },
  { field: "location", match: "equals",   value: "Zoom", caseSensitive: true }
]
```

| Key | Values | Default | Notes |
|---|---|---|---|
| `field` | `"title"` \| `"location"` \| `"description"` | `"title"` | |
| `match` | `"contains"` \| `"equals"` \| `"regex"` | `"contains"` | |
| `value` | string | required | Regex **source** when `match: "regex"` — no slashes. |
| `caseSensitive` | boolean | `false` | Ignored for `regex`; use inline flags such as `(?i)` semantics via your pattern instead. |

Rules are applied server-side, before layout. A rule matching `description` can remove an event for a
reason invisible on screen — prefer `title` where possible.

> **Footgun:** on a free/busy-only feed *every* event is titled `Busy`, so
> `{ value: "Busy" }` empties the whole calendar.

---

## Derived layout

`days`, `width` and `height` are the inputs. The rest is computed:

```
rowHeight    = height / (hourLength * 2)
indexWidth   = measured width of the widest hour label + padding
columnWidth  = (width - indexWidth) / days
baseFontSize = min(rowHeight * 1.36, columnWidth * 0.09) * fontScale
```

Two independent constraints drive the font, and the smaller wins:

- **Vertical** — a 30-minute event must fit one line of title inside one row.
- **Horizontal** — a column must hold a readable title without wrapping everything.

Because the hour axis scales with the font, the horizontal constraint is circular and is solved
directly rather than iterated:

```
baseFontSize = (0.09 * width) / (days + 0.09 * 1.82)
```

The ratios (`1.36`, `0.09`, `1.82`, `1.59`) were measured from a real rendered board, not chosen.
On the 1196×800 / `days: 3` reference the derivation returns `rowHeight` 25, `baseFontSize` **34**,
`columnWidth` **378** and `indexWidth` **62** — matching the measured board exactly. Both constraints
land on 34 simultaneously, which is what a balanced layout looks like.

Run `dev/harness.html` in a browser to verify; it needs no server, no Node, and no MagicMirror.

---

## Hard limits

### Minimum board size

The floor is wherever the derived font would fall below `minFontSize` (default 14).

| `days` | Minimum width |
|---|---|
| 1 | 182px |
| 2 | **337px** |
| 3 | **493px** |
| 4 | **648px** |

Minimum height is independent of `days`: `hourLength * 2 * (minFontSize / 1.36) + 64`, where 64 is
the day header plus the all-day bar. For the default 16-hour window that is **394px**; a 24-hour
window needs **559px**.

Below the minimum, `onUndersize` decides. If even `days: 1` will not fit, a notice renders regardless
of the setting — a silently broken grid is the worse outcome.

### Maximum feeds: 8 (warning above 6)

**This limit is about colour, not layout, and it does not vary with `days`.** Every calendar colour is
mixed `eventTint` toward white before display, which compresses the gamut hard. In practice two greens
picked 19.5 ΔE apart *before* mixing still needed re-picking afterwards, and nearby greens collapse to
ΔE ~6 — indistinguishable. Past roughly 8 feeds the colour key stops carrying information no matter
how much room the grid has.

### Concurrent events per column

Not a cap but a guarantee. Since `minTileWidth` and `baseFontSize` both scale with `columnWidth`,
their ratio is constant when the horizontal constraint binds and larger when the vertical one does:

```
maxLanes = floor(columnWidth / minTileWidth) ≈ floor(1 / (1.59 * 0.09)) = 6
```

**At least 6 concurrent events render side by side at any valid board size**, and 7 on boards where
the vertical constraint binds — including the 1196×800 reference. `derive()` returns the exact
`maxLanes` for your configuration.

---

## Behaviour contract

Four states where "nothing shown" would otherwise be ambiguous. A single **corner note** carries all
of them — a small line at the board's edge that renders nothing when everything is healthy.

| State | Behaviour |
|---|---|
| **Feed stale** | Last-good events are kept indefinitely. Past `staleAfterMinutes` the feed is named in the corner note with an age, e.g. `Work · 3h`. |
| **Cold start** | The grid chrome — hour axis, day headers, today ring — paints immediately, with a quiet loading state where events go, replaced as feeds land. Nothing is cached to disk. |
| **Invalid config, partial** | A calendar entry with a missing `url`, bad colour, or duplicate name is skipped; everything else renders and the entry is named in the corner note. |
| **Invalid config, fatal** | No valid calendars, or a non-numeric `days` / `hourLength`, renders an error panel listing every problem instead of the grid. |
| **Second instance** | Only one instance is supported. A second renders the fatal panel naming the conflict. |

---

## Getting an ICS URL

**Google Calendar:** *Settings → Settings for my calendars → \[calendar] → Integrate calendar →
**Secret address in iCal format***.

> Do **not** use the `cid=…` link offered by *Share* or "Get shareable link" — that is an HTML page,
> not a feed, and it will not parse.

Treat the secret address like a password; anyone with it can read the calendar. Keep it in your
MagicMirror config, never in a public repository.

## Known feed behaviours

These look like module bugs and are not:

- **Every event is titled `Busy`.** The feed is shared as *free/busy only*. Some Workspace domains
  permit no other sharing level for iCal. There are no titles, locations, or descriptions to render.
- **Events marked *Free* are missing.** Free/busy feeds omit `TRANSP:TRANSPARENT` events entirely, so
  they never reach the module.
- **A recurring meeting appears only once, or not at all.** Some exports publish every instance as a
  standalone entry with `RECURRENCE-ID` and no master `RRULE`. This module handles that case; the
  built-in MagicMirror `calendar` module does not.

## Troubleshooting

| Symptom | Check |
|---|---|
| Empty grid, no error | Is it still cold-starting? A feed can take up to `fetchTimeout`. |
| One calendar missing | Look at the corner note — a skipped config entry or a stale feed is named there. Then check the URL is an iCal address, not a `cid=` link. |
| All-day events off by one day | Should be impossible: all-day events cross the wire as calendar dates, never timestamps. If it happens, file an issue with the offending `VEVENT`. |
| Tiles too narrow, titles clipped | Too many concurrent events for the column width. Widen `width`, lower `days`, or accept the ellipsis — see the concurrency guarantee above. |
| Text too small at a distance | Raise `fontScale`. Do not set `baseFontSize` unless you also intend to break the derived proportions. |
| `days: 5` renders 4 | Working as documented. See [Hard limits](#hard-limits). |

## Licence

MIT © Jack Lozano
