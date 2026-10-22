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
| `line` | `#2C3452` | Dividers, card borders, map roads (decorative only: 1.5:1) |
| `line-strong` | `#5E6A94` | Input and secondary-button borders (3.2:1 on `surface`, meets WCAG 1.4.11) |
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

**Contrast:** all text pairs above pass WCAG AA (4.5:1); checked: lowest is white on `red`, 4.83:1. White text goes on `#D92D20` only, never on a lighter red. `line` is too faint for anything a user must find (inputs, secondary buttons), so use `line-strong` there.

**Class names:** the table's `green` and `red` tokens are named `safe` and `danger` in code, so they don't clash with Tailwind's built-in palettes.

### Tailwind config

`create-next-app` installs **Tailwind v4**, which has no `tailwind.config.ts`. Tokens go in `src/app/globals.css`:

```css
@theme {
  --color-ink: #0E1220;
  --color-surface: #171C2E;
  --color-surface-2: #212842;
  --color-line: #2C3452;
  --color-line-strong: #5E6A94;
  --color-text: #F3F1EA;
  --color-muted: #A3ABC2;
  --color-amber: #F7B538;
  --color-amber-ink: #1A1405;
  --color-amber-tint: #2A2410;
  --color-safe: #4FD18B;
  --color-safe-ink: #06210F;
  --color-safe-tint: #13301F;
  --color-danger: #D92D20;
  --color-danger-soft: #FF9A92;
  --color-danger-ground: #1A0B0B;
  --color-danger-surface: #2A1414;
}
```

Classes then read `bg-ink`, `bg-surface-2`, `text-muted`, `border-line-strong`, `bg-safe`, `text-danger-soft`.

**shadcn/ui:** point its variables at the tokens so its components match: `--background: ink`, `--card`/`--popover: surface`, `--foreground: text`, `--primary: amber`, `--primary-foreground: amber-ink`, `--secondary`/`--muted: surface-2`, `--muted-foreground: muted`, `--destructive: danger`, `--border: line`, `--input: line-strong`, `--ring: amber`, `--radius: 14px`. Dark only; there's no light theme.

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
| Secondary | 1px `line-strong` border, transparent, `text` | "Set a solo check-in instead" |
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

52px tall, `surface` bg, 1px `line-strong` border, 14px radius, 16px text (prevents iOS zoom). Label above in 13px/600 `muted`.

### Duration picker

4-column grid of pill buttons (10/15/20/30 min). Selected: `amber-tint` bg, `amber` border and text, `aria-pressed="true"`.

### Countdown ring

220px SVG ring, 14px stroke, `surface-2` track, `amber` progress, mono time in the centre with "check in by HH:MM" underneath.

### Bottom tab bar

4 tabs: Tonight (`/`), Sessions (`/sessions`), Groups (`/groups`: your verified communities), Safety (`/safety`: 999, contacts, your check-ins). Icon above label, 12px text. Active = `amber`, inactive = `muted`. Top border `surface-2`.

### Icons

Inline stroke icons (Lucide, which ships with shadcn), 2–2.5px stroke, `currentColor`. **No emoji in the UI**, including SOS. This overrides the ✅ / 🆘 in CLAUDE.md and the Cursor prompts: use a house icon + "I'm home" and the word "SOS".

### Logo

Three stacked chevrons ("birds"): two amber, one off-white. Wordmark "Flock" in Manrope 800.

---

## 6. Screens

| # | Screen | Purpose | Primary action |
|---|---|---|---|
| 1 | Sign in | Verify with university email, then type the code from the email (6–8 digits; the link in the email also works) | Send code → Verify |
| 2 | Tonight | Your current session + events ending soon | Find a walk buddy |
| 3 | Match found | Pick a station, see up to 3 people heading your way and why to trust them | Walk with [name] |
| 4 | Walking home | Live map, ETA, group watching | I'm home (+ SOS) |
| 5 | Solo check-in | Timer when nobody's going your way | Start walk |
| 6 | SOS | Emergency | Call 999 |
| 7 | Society Safety HQ (web) | Society's view: stats, incidents, blocklist | I'm calling them / Mark safe |

### Flow

```
Sign in → Tonight → Match found → Walking home → I'm home ✓
                 ↘ Solo check-in ↗        ↘ SOS
Missed check-in → group nudged → incident in Safety HQ → Grok Bot recommends → human decides
```

### Screen notes

- **Tonight:** Session card always sits at the top. "Set a solo check-in instead" is always available as a fallback.
- **Match found:** show "Matched in N seconds". This is the 10x metric, so make it visible. Show 1 main match plus up to 2 alternatives. Tapping "Walk with Amara" creates the match and it appears live on Amara's phone. If nobody's there yet, show a waiting state with a live elapsed timer; a new person appears without refresh.
- **Walking home:** map takes the top ~55%; bottom sheet overlaps it by 28px. Show a "Live · group can see you" pill on the map **only while location is actually being shared** (see Live location in section 7). Route: solid amber for walked, dotted amber for remaining. SOS button is always visible next to "I'm home".
- **Solo check-in:** clearly list who gets alerted and in what order (session group first, safety team 10 min later).
- **SOS:** whole screen switches to `red-ground`. Order: Call 999 (biggest) → Alert my group and society → who receives your location → "I'm safe, cancel". Pressing SOS sends your current location once to your buddy, session group and society lead, even after you've passed the station.
- **Safety HQ (web):** sidebar nav (Tonight, Incidents, Safety rules, Shared blocklist, Members). Incident card with timeline + Grok Bot recommendation card (amber border) citing the rule it's based on. Always show: *"A human decides. Grok Bot only recommends."*

---

## 7. Map

Leaflet with standard OpenStreetMap tiles darkened by a CSS filter (`.flock-dark-tiles`) so they match `ink`.

- Route line: `amber`, 4px. Walked part solid, remaining part dashed.
- You: off-white dot with a soft amber halo + "You" label.
- Buddy: green dot with green halo + first-name label.
- Station: ring marker in `amber` with the station name label.
- Never show or store home addresses. Destinations are stations only.
- **Tiles:** standard OSM tiles (free, no key) with "© OpenStreetMap contributors". CARTO Dark Matter now needs an API key, so it is not used.
- **Route:** a straight line from the session to the station. There's no routing service in the allowed data sources, so don't draw street-by-street routes.

### Live location (walking home)

- Shared over **Supabase Realtime broadcast** on a channel per match (or per solo trip). **Never written to the database.**
- Who sees it: your buddy and your session group, and nobody else.
- Starts when you tap "Walk with…" or "Start walk". **Stops automatically within 200 m of the destination station**, so it never gets near a home address. It also stops on "I'm home" or when you tap the pill to pause.
- Asks for browser location permission with a plain reason first: "So your group can see you until you reach the station."
- If permission is denied, the walk still works: the pill reads "Location off", and check-ins still protect you.

---

## 8. Voice & copy

- Short, warm, plain. Talk like a friend, not a security company.
- Use first names: "Walk with Amara", not "Walk with user".
- Times in 24h: "23:30", always in **Europe/London** time (Vercel servers run in UTC, so pass the timezone explicitly).
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

---

## 11. Screens not in the mockups

Build these with the same tokens and components:

| Screen | Route | Notes |
|---|---|---|
| Code entry | `/login` (step 2) | One mono field (6–8 digits), `inputmode="numeric"`, `autocomplete="one-time-code"` |
| Onboard | `/onboard` | First name, optional GitHub. Copy: "Matches only ever see your first name." |
| Not a university email / blocked | `/login`, `/onboard` | Calm `surface` card, not red. Say what to do next. |
| Sessions list + create | `/sessions`, `/sessions/new` | Event rows; create uses inputs + a small map to pick the location |
| Session detail | `/sessions/[id]` | Session card + Join + "Find a walk buddy" |
| Waiting for a match | `/sessions/[id]/walk` | Mono elapsed timer, "We'll show people as they join", secondary "Set a solo check-in instead" |
| Report | sheet on the match card | Kind + evidence (required). "A human from your society reviews every report." |
| Groups | `/groups` | Community cards: name, verified domain badge, member count, next session |
| Safety | `/safety` | Call 999, university contacts, your active walk or timer |
| Empty / error / loading | everywhere | Skeleton cards on `surface`; errors say what failed and offer retry; labelled fallbacks ("Cognee reason unavailable") |

## 12. Audit notes (22 Oct, 20:15)

Fixed above: Tailwind v4 tokens instead of `tailwind.config.ts`; `green`/`red` vs `safe`/`danger` naming; shadcn variable mapping; new `line-strong` token for inputs (`line` was 1.5:1); 11px tab labels raised to 12px; "I'm calling him" changed to "them"; sign in uses a code; the Groups tab is defined; live location rules (team decision); pick from up to 3 matches (team decision); CARTO attribution; straight-line routes only; London time zone; emoji rule overrides CLAUDE.md; missing screens listed.
