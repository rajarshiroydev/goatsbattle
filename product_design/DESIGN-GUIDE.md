# GOATSBattle — Design Guide (v1, "Stadium Gate")

The definitive spec for implementing GOATSBattle. Derived from the finalised 2b "Stadium Gate" direction. Hand this to engineering as-is.

---

## 1. Brand essence

- **Idea:** A sports arena for arguments. Every page should feel like a scoreboard + a stadium floor: loud condensed headlines, quiet mono data labels, dark room, lime spotlight.
- **Voice:** Confident, provocative, second-person. "Who's the GOAT? Argue it out." "Defend your GOAT…" "Counter this take →". Never corporate.
- **The pattern everywhere:** big Barlow Condensed statement + small mono label + one lime action.

## 2. Color tokens

```css
:root {
  /* Core */
  --bg:        #0d0d0f;  /* page background */
  --bg-deep:   #0a0a0c;  /* battle/immersive pages */
  --surface:   #161618;  /* cards, rows, panels */
  --sunken:    #0d0d0f;  /* inset wells inside cards */
  --border:    #252528;  /* default 1px borders */
  --border-hi: #3a3a3e;  /* hover borders, VS badge ring */

  /* Text */
  --text:      #f0f0f2;  /* primary */
  --text-2:    #b6b6c0;  /* body/secondary */
  --text-3:    #8c8c96;  /* mono labels, metadata */

  /* Accent */
  --lime:      #c8ff00;  /* THE brand accent: CTAs, live pulses, links, "your side" */
  --lime-down: #a3cc00;  /* lime hover */
  --red:       #ff2d55;  /* live/urgent + the opposing side in any battle */

  /* Arena identities (chips, tags, hover borders, tints) */
  --arena-football: #C6FF00;
  --arena-cricket:  #2E7DD1;
  --arena-tennis:   #22A06B;
  --arena-f1:       #E8202A;
}
```

Rules:
- Lime is scarce: 1 primary CTA per view + live dots + key numbers. Never lime body text.
- In any head-to-head, **left/champion = lime, right/challenger = red** — always.
- Arena colors only as accents (tags, 8px squares, tints at 5–12% alpha, hover borders). Never as fills behind text.
- Tints: `rgba(198,255,0,0.06–0.12)` for lime washes; same alpha range for arena tints.
- Hero glow: `radial-gradient(ellipse 80% 60% at 20% 120%, rgba(200,255,0,0.08), transparent 60%)`.

## 3. Typography

```html
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:ital,wght@0,700;0,800;0,900;1,900&family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700&display=swap" rel="stylesheet">
```

| Role | Font | Spec |
|---|---|---|
| Display / headlines | Barlow Condensed 900 | UPPERCASE, line-height 0.85–0.95, letter-spacing −0.02–0em. Hero 76–118px, section 30–44px, card title 22–34px, fighter names 96px |
| Buttons | Barlow Condensed 800 | UPPERCASE, 13–17px, letter-spacing 0.06em |
| Team tags | Barlow Condensed 900 | UPPERCASE, 10px |
| Body | DM Sans | 13–16px, line-height 1.45–1.55, color `--text-2` |
| Usernames | DM Sans 600 | 13px, `--text` |
| Data labels / meta | `ui-monospace, Menlo, monospace` | 10–12px, UPPERCASE, letter-spacing 0.1–0.2em, `--text-3` (lime/red when charged) |
| VS mark | Barlow Condensed 900 italic | 20–30px, `--text-3` or `--text` |

Never use the mono face for sentences — labels, counts, and tickers only.

## 4. Shape, space, elevation

- Radii: **2px** buttons & team tags · **6px** cards/rows/inputs · **8px** large feed cards · **99px** chips, dots, avatars.
- Borders everywhere are 1px `--border`; interactive rows brighten to `--border-hi` (or a semantic color) on hover. No shadows except marquee cards: `0 4px 24px rgba(0,0,0,0.5)`.
- Page gutter: 32px. Card padding: 16–18px. Row padding: 13px 18px. Vertical gap between rows: 10–12px.
- Nav bar: 60px tall, border-bottom `--border`.
- Section rhythm: header row (display title + chips + right-aligned mono stat) → 16px → content.

## 5. Core components

### Nav (every page)
Logo `GOATS` white + `BATTLE` lime, Barlow 900 21px. Center links (DM Sans 500 14px, `--text-2`; hover `--text` + `--surface` pill; **active = lime text**): The Floor · Goats · Arenas · Rankings · Face Off. Right: **Play Now** primary button.

### Buttons
- **Primary:** lime bg, `#0d0d0f` text, radius 2px, padding 8–13px × 16–28px; hover `--lime-down`.
- **Secondary:** transparent, 1px `--border-hi` border, white text; hover lime border + lime text.
- **Danger/challenger:** red outline; hover fills red with dark text.

### Chips (filters)
Mono 11px uppercase, radius 99px, padding 5px 14px. Active: lime bg dark text. Inactive: `--text-3` + `--border` border; hover white text + `--border-hi`.

### Team tag
`Barlow 900 10px uppercase, radius 2px, padding 2px 6px`, arena/side color bg, dark text (white text on red/blue). Marks which side a user is on. Appears before username on every take.

### Take row (The Floor)
Surface row, radius 6px: team tag + username + mono context (`⚽ Messi vs Ronaldo · 12m`) + upvote `▲ n` right-aligned in lime. Expanded form adds 15px DM Sans 600 take text, reply count, `Counter this take →` in lime mono, and an inline composer.

### Composer
Sunken well (`--sunken`, 1px `--border`, radius 6px): your team tag + ghost text `--text-3` + lime **Post** button. When a side is picked, tint the well with that side's color at 6% + 44% border.

### Vote bar
4–6px tall, flex: lime segment vs red segment, radius 99px (square when full-bleed at a section's bottom edge).

### Marquee battle card / carousel
Header row (mono "MARQUEE BATTLE" + arena tag) ÷ border ÷ names 27–34px Barlow 900 + % in side colors + italic VS ÷ vote bar ÷ mono votes + `Cast yours →`. Auto-advances every 3.5s with 280ms opacity fade; pill dots (active = 22px lime, idle = 6px `--border-hi`).

### Live indicators
7–8px lime dot, `gb-pulse` 2s infinite (opacity 1 → 0.35). Red dot + mono `● LIVE` for match threads (pulse 1.4s).

```css
@keyframes gb-pulse { 0%,100%{opacity:1} 50%{opacity:.35} }
```

### Stat ticker
Full-width strip of equal cells divided by `--border`: Barlow 900 24px lime number + mono label.

## 6. The Battle page (split-arena pattern)

Full-bleed 50/50 split, bg `--bg-deep`:
- Left fighter: lime-tinted gradient `linear-gradient(160deg,#141608,#0a0a0c 70%)`; mono kicker `THE CHAMPION · 52%` lime; name 96px Barlow 900 (first name white, surname lime); ghost jersey number 220px at 6% lime; bio line; **Vote [name]** primary button.
- Right fighter: mirrored, red: gradient `linear-gradient(200deg,#170a0e,#0a0a0c 70%)`, kicker `THE CHALLENGER · 48%`, surname red, outlined red vote button.
- Center: 76px circular VS badge, `--bg-deep` fill, `--border-hi` ring, shadow `0 0 40px rgba(0,0,0,0.8)`.
- Bottom: shared lime/red vote bar.
- Below the fold: tale-of-the-tape stat rows (stat name mono center, values Barlow 900 either side, leader in side color) → The Floor take stream filtered to this battle.

## 7. Motion

- Hovers: border-color / color only, ~150ms. No scale, no lift.
- Carousel: 3.5s interval, 280ms fade, 400ms bar width ease.
- Vote cast: bar animates width 400ms ease; % counts up.
- Live dots pulse forever. Nothing else moves on its own.

## 8. Page inventory

| Page | Route | Pattern |
|---|---|---|
| Landing | `/` | 2b: slim hero + marquee carousel → The Floor stream |
| The Floor | `/floor` | Full take stream: chips, composer, expanded + compact rows |
| Arenas | `/arenas` | 2×2 arena cards with marquee battle inside each |
| Goats | `/goats` | Filterable goat directory grid |
| Rankings | `/rankings` | Arena-tabbed leaderboard table |
| Face Off | `/faceoff` | Two fighter slots + VS + Battle CTA |
| Battle | `/battle/:id` | Split-arena (see §6) |
| Champion Mode | `/play` | Gauntlet: round progress + quick-fire pair |

All numbers shown are live and mono. Every list row is clickable (whole row, cursor pointer, border hover).
