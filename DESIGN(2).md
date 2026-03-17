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

| Role             | Family              | Size                        | Weight | Transform  | Tracking      |
| ---------------- | ------------------- | --------------------------- | ------ | ---------- | ------------- |
| UI / body        | Inter               | 16px base                   | 400    | —          | —             |
| Nav links        | Inter               | 11px                        | 400    | uppercase  | 0.15em        |
| Logo             | Inter               | 11px                        | 500    | uppercase  | 0.15em        |
| Hero heading     | Inter               | `clamp(3rem, 10vw, 7.5rem)` | 300    | —          | −0.03em       |
| Body copy        | Inter               | 14px                        | 400    | —          | —             |
| Project title    | Playfair Display    | 14px                        | 400    | italic     | 0.02em        |
| Tags / year      | Inter               | 11px                        | 400    | —          | 0.03em        |
| Footer copy      | Inter               | 11px                        | 400    | —          | 0.05em        |

**Google Fonts load**: `Inter` (300, 400, 500) + `Playfair Display` (regular + italic 400). Both loaded with `display=swap`.

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
- **Restraint on weights** — Light (300) for the hero, Regular (400) everywhere else, Medium (500) for the logo only.
- **Warm neutrals only** — `#F5F2ED` and `#1A1A1A` as the poles; `#888` for recessed information.
