# Design Tokens

Reference for all design decisions in the portfolio. The canonical source of truth is `src/styles/global.css`; this document explains intent.

---

## Color

| Token            | Value     | Usage                                  |
| ---------------- | --------- | -------------------------------------- |
| `--color-bg`     | `#F5F2ED` | Page background — warm off-white       |
| `--color-text`   | `#1A1A1A` | Primary text, headings, logo           |
| `--color-mid`    | `#888888` | Secondary text: tags, year, nav links (default state), footer copy |
| `--color-accent` | `#1A1A1A` | Accent — same as text; no separate hue |

No pure black (`#000`) or pure white (`#FFF`) anywhere. The warmth of `#F5F2ED` is intentional.

---

## Typography

| Role                    | Family           | Size                        | Weight | Transform  | Tracking      |
| ----------------------- | ---------------- | --------------------------- | ------ | ---------- | ------------- |
| UI / body               | Space Mono       | 16px base                   | 400    | —          | —             |
| Nav links               | Space Mono       | 11px                        | 400    | uppercase  | 0.15em        |
| Logo                    | Space Mono       | 11px                        | 400    | uppercase  | 0.15em        |
| Hero — "Work"           | Space Mono       | `clamp(3rem, 10vw, 7.5rem)` | 400    | —          | −0.03em       |
| Hero — "Selected"       | Playfair Display | `clamp(3rem, 10vw, 7.5rem)` | 400    | italic     | −0.03em       |
| Body copy               | Space Mono       | 14px                        | 400    | —          | —             |
| Project title           | Space Mono       | 14px                        | 400    | italic     | 0.02em        |
| Nav menu numbers        | Space Mono       | 11px                        | 400    | —          | —             |
| Nav menu labels         | Space Mono       | 12px                        | 400    | uppercase  | 0.12em        |
| Tags / year             | Space Mono       | 11px                        | 400    | —          | 0.03em        |
| Footer copy             | Space Mono       | 11px                        | 400    | —          | 0.05em        |

**Google Fonts load**: `Space Mono` (400, 700, italic variants) + `Playfair Display` (regular + italic 400). Both loaded with `display=swap`.

**Two-font rule**: Playfair Display is used exclusively for the word "Selected" in the hero heading. Everything else is Space Mono.

---

## Spacing

8px base unit. Use only these steps — no ad-hoc values.

| Token        | Value  |
| ------------ | ------ |
| `--space-1`  | 8px    |
| `--space-2`  | 16px   |
| `--space-3`  | 24px   |
| `--space-4`  | 32px   |
| `--space-6`  | 48px   |
| `--space-8`  | 64px   |
| `--space-12` | 96px   |

`--space-6` doubles as the standard horizontal page padding and is overridden at breakpoints (24px at ≤768px, 16px at ≤480px).

---

## Layout

| Property             | Value                                            |
| -------------------- | ------------------------------------------------ |
| Max content width    | 1200px (`--max-width`)                           |
| Horizontal padding   | 48px (`--space-6`) — responsive, see above       |
| Nav height           | 60px (`--nav-height`)                            |
| Border radius        | **0** — no rounded corners anywhere              |
| Grid columns         | 2 on desktop, 1 on mobile (≤768px)               |
| Grid gap             | 2px — tight seam, not a gutter                   |
| Card image ratio     | 3 / 2                                            |

---

## Motion

| Element           | Property  | Duration | Easing                        |
| ----------------- | --------- | -------- | ----------------------------- |
| Card thumbnail    | transform | 400ms    | `cubic-bezier(0.4, 0, 0.2, 1)` |
| Card title        | transform | 300ms    | `cubic-bezier(0.4, 0, 0.2, 1)` |
| Nav / footer links | color    | 200ms    | `cubic-bezier(0.4, 0, 0.2, 1)` |
| Skip link         | transform | 200ms    | `cubic-bezier(0.4, 0, 0.2, 1)` |

Hover state: thumbnail scales to `1.03×`, title translates `−4px` on Y. No box-shadows, no borders added on hover.

---

## Principles

- **Whitespace is content.** Resist the urge to fill gaps.
- **No decorative borders or dividers** except the 1px footer rule at 8% opacity.
- **Restraint on weights** — Regular (400) throughout; Bold (700) available but used sparingly.
- **Warm neutrals only** — `#F5F2ED` and `#1A1A1A` as the poles; `#888` for recessed information.
