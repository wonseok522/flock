# Flock: Design

> Study together. Get home together.

This file describes Flock's UI so Cursor (and anyone on the team) can build screens that match the mockups. Stack: Next.js, Tailwind CSS, shadcn/ui, Leaflet.

---

## 1. Principles

1. **Calm at 11pm.** Dark, low-glare UI. Nothing flashes or alarms unless it's an emergency.
2. **One big action per screen.** Every screen has a single obvious primary button (amber), with secondary actions quieter.
3. **Show why, not just who.** Every match explains why you can trust the person.
4. **Red means emergency only.** Red is reserved for SOS, missed check-ins and incidents. Never use it for decoration.
5. **Privacy is visible.** Remind users we use stations, not home addresses, and first names only.
6. **999 first.** The SOS screen always puts calling 999 above anything Flock does.

---

## 2. Colour tokens

Theme name: **Night street**: deep navy ground, streetlamp-amber accent.

| Token | Hex | Use |
|---|---|---|
| `ink` | `#0E1220` | App background |
| `surface` | `#171C2E` | Cards, bottom sheets, inputs |
| `surface-2` | `#212842` | Chips, secondary buttons, progress track |
| `line` | `#2C3452` | Borders, dividers, map roads |
| `text` | `#F3F1EA` | Primary text |
| `muted` | `#A3ABC2` | Secondary text, labels |
| `amber` | `#F7B538` | Primary action, highlights, routes, times |
| `amber-ink` | `#1A1405` | Text on amber |
| `amber-tint` | `#2A2410` | Selected pill / badge background |
| `green` | `#4FD18B` | Safe, verified, "I'm home", trust checks |
| `green-ink` | `#06210F` | Text on green |
| `green-tint` | `#13301F` | Verified badge background |
| `red` | `#D92D20` | SOS button, incident borders, alert badges |
| `red-soft` | `#FF9A92` | Red text on dark backgrounds |
| `red-ground` | `#1A0B0B` | SOS screen background |
| `red-surface` | `#2A1414` | Cards on SOS screen, incident chips |

Avatar colours (first-name initials): `#F7B538`, `#4FD18B`, `#8FA8FF`, `#F28FB8`, each with a dark ink text colour.

**Contrast:** all text pairs above pass WCAG AA (4.5:1). White text goes on `#D92D20` only, never on a lighter red.

### Tailwind config

```js
// tailwind.config.ts → theme.extend.colors
colors: {
  ink: '#0E1220',
  surface: { DEFAULT: '#171C2E', 2: '#212842' },
  line: '#2C3452',
  text: '#F3F1EA',
  muted: '#A3ABC2',
  amber: { DEFAULT: '#F7B538', ink: '#1A1405', tint: '#2A2410' },
  safe: { DEFAULT: '#4FD18B', ink: '#06210F', tint: '#13301F' },
  danger: { DEFAULT: '#D92D20', soft: '#FF9A92', ground: '#1A0B0B', surface: '#2A1414' },
},
```

---

## 3. Typography

| Role | Font | Size / weight | Notes |
|---|---|---|---|
| Hero (sign in, SOS) | Manrope | 34px / 800 | letter-spacing -0.03em, line-height 1.1 |
| Screen title | Manrope | 22–30px / 800 | letter-spacing -0.02em |
| Card title | Manrope | 20–22px / 800 | |
| Body | Manrope | 15–16px / 400–600 | line-height 1.5 |
| Label / caption | Manrope | 12–13px / 600–700 | |
| Section eyebrow | Manrope | 12px / 700 | UPPERCASE, letter-spacing 0.06em, `muted` |
| Times, ETAs, counts | JetBrains Mono | 13–48px / 500–600 | anything that's a clock or a number |

```html
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500;600&display=swap" rel="stylesheet">
```

In Next.js, use `next/font/google` for both.

---

## 4. Spacing, radius, sizing

- **Base unit:** 4px. Common gaps: 8, 10, 12, 16, 20, 24.
- **Screen padding:** 20px sides (24px on sign in), 52–56px top, 28px bottom.
- **Radius:**
  - Pills / avatars: `999px`
  - Buttons & inputs: `14–16px`
  - Cards: `18–24px`
  - Bottom sheet: `28px` top corners
  - Big SOS button: `28px`
- **Touch targets:** minimum 44×44px. Primary buttons are 52–56px tall.
- **Phone frame:** design at 390×844.

---

## 5. Components

### Buttons

| Variant | Style | Use |
|---|---|---|
| Primary | `amber` bg, `amber-ink` text, 800 weight, 54px tall | One per screen: "Find a walk buddy", "Walk with Amara", "Start walk" |
| Secondary | 1px `line` border, transparent, `text` | "Set a solo check-in instead" |
| Text link | no bg, `muted` text | "Not right? Walk solo with a check-in" |
| Safe | `green` bg, `green-ink` text | "I'm home" only |
| Danger | `red` bg, white text | "SOS", "Call 999" only |
| Outline on red | 2px `text` border, transparent | "Alert my group and society" |

### Badges & chips

- **Verified badge:** `green-tint` bg, `green` text, check icon. "Verified · UCL".
- **Time chip:** `amber-tint` bg, JetBrains Mono, "ends 23:30".
- **Person chip:** `surface-2` pill with a 26px avatar + first name.
- **Status dot:** 8px circle. Green = live/safe, red = incident.

### Avatars

Circle, first initial only, 800 weight. Sizes: 26 (chip), 32 (list), 56 (match card). Stack overlapping avatars with `-8px` margin and a 2px border in the card colour; end with a `+N` avatar.

### Cards

- **Session card (highlighted):** `surface` bg, 1px `amber` border, 24px radius, eyebrow "YOUR SESSION", end time chip, title, avatar stack, primary + secondary buttons.
- **Event row:** time in amber mono, title + venue, small "Join" button.
- **Match card:** large avatar, first name, "Verified UCL student", leaving time; divider; **"WHY YOU CAN TRUST …"** list with green check icons (one reason per line).
- **Stat tile (web):** `surface`, label in `muted`, big mono number. Incident tile uses `red-surface` with a red border.

### Trust reasons (from Cognee)

Always 2–4 short, specific, factual lines:
- "At Late study with you tonight"
- "You've studied together 3 times this term"
- "Walked home safely with 5 Flock members"
- "Member of The Hack Collective"

Never show a score or rating, only reasons.

### Inputs

52px tall, `surface` bg, 1px `line` border, 14px radius, 16px text (prevents iOS zoom). Label above in 13px/600 `muted`.

### Duration picker

4-column grid of pill buttons (10/15/20/30 min). Selected: `amber-tint` bg, `amber` border and text, `aria-pressed="true"`.

### Countdown ring

220px SVG ring, 14px stroke, `surface-2` track, `amber` progress, mono time in the centre with "check in by HH:MM" underneath.

### Bottom tab bar

4 tabs: Tonight, Sessions, Groups, Safety. Icon above label, 11px text. Active = `amber`, inactive = `muted`. Top border `surface-2`.

### Icons

Inline stroke icons (Lucide works well with shadcn), 2–2.5px stroke, `currentColor`. **No emoji in the UI**, including SOS.

### Logo

Three stacked chevrons ("birds"): two amber, one off-white. Wordmark "Flock" in Manrope 800.

---

## 6. Screens

| # | Screen | Purpose | Primary action |
|---|---|---|---|
| 1 | Sign in | Verify with university email | Send magic link |
| 2 | Tonight | Your current session + events ending soon | Find a walk buddy |
| 3 | Match found | Pick a station, see your match and why to trust them | Walk with [name] |
| 4 | Walking home | Live map, ETA, group watching | I'm home (+ SOS) |
| 5 | Solo check-in | Timer when nobody's going your way | Start walk |
| 6 | SOS | Emergency | Call 999 |
| 7 | Society Safety HQ (web) | Society's view: stats, incidents, blocklist | I'm calling him / Mark safe |

### Flow

```
Sign in → Tonight → Match found → Walking home → I'm home ✓
                 ↘ Solo check-in ↗        ↘ SOS
Missed check-in → group nudged → incident in Safety HQ → Grok Bot recommends → human decides
```

### Screen notes

- **Tonight:** Session card always sits at the top. "Set a solo check-in instead" is always available as a fallback.
- **Match found:** show "Matched in N seconds". This is the 10x metric, so make it visible. Show 1 main match plus up to 2 alternatives.
- **Walking home:** map takes the top ~55%; bottom sheet overlaps it by 28px. Show a "Live · group can see you" pill on the map. Route: solid amber for walked, dotted amber for remaining. SOS button is always visible next to "I'm home".
- **Solo check-in:** clearly list who gets alerted and in what order (session group first, safety team 10 min later).
- **SOS:** whole screen switches to `red-ground`. Order: Call 999 (biggest) → Alert my group and society → who receives your location → "I'm safe, cancel".
- **Safety HQ (web):** sidebar nav (Tonight, Incidents, Safety rules, Shared blocklist, Members). Incident card with timeline + Grok Bot recommendation card (amber border) citing the rule it's based on. Always show: *"A human decides. Grok Bot only recommends."*

---

## 7. Map

Leaflet with a dark tile layer (e.g. CartoDB Dark Matter) so it matches `ink`.

- Route line: `amber`, 4px. Walked part solid, remaining part dashed.
- You: off-white dot with a soft amber halo + "You" label.
- Buddy: green dot with green halo + first-name label.
- Station: ring marker in `amber` with the station name label.
- Never show or store home addresses. Destinations are stations only.

---

## 8. Voice & copy

- Short, warm, plain. Talk like a friend, not a security company.
- Use first names: "Walk with Amara", not "Walk with user".
- Times in 24h: "23:30".
- Headlines that reassure: "Walk solo, not alone", "Heading home?", "In danger? Call 999 first."
- Avoid fear words ("danger zone", "threat level") outside the SOS screen.

---

## 9. Accessibility

- Real `<button>`, `<a>`, `<input>` + `<label>` elements; no clickable divs.
- `aria-label` on icon-only buttons (Back, Profile, SOS).
- Decorative SVGs get `aria-hidden="true"`.
- Selected states use `aria-pressed`.
- Don't rely on colour alone: "I'm home" has a house icon, SOS has text, incidents have a label.
- Body text is never below 13px.
- Respect `prefers-reduced-motion` for any map or ring animation.

---

## 10. Mobile polish

- `viewport-fit=cover` and safe-area padding for the notch and home bar.
- Use `100dvh`, not `100vh`.
- Inputs at 16px to stop iOS zoom.
- `-webkit-tap-highlight-color: transparent` and pressed states instead of hover.
- `theme-color` meta set to `#0E1220` so the browser bar matches.
