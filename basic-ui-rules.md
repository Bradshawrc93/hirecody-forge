# Design System — HireCody Portfolio

Apply this design system consistently. It's a fresh, editorial, minimal aesthetic — mint-green palette, generous whitespace, restrained typography. Avoid flashy gradients, heavy shadows, dark mode, or any color outside this palette unless I explicitly ask.

## Color Palette (light mode only)

| Token | Hex | Use |
|---|---|---|
| `background` | `#F1F6F2` | Page background (mint-tinted off-white) |
| `foreground` | `#15302A` | Primary text (deep forest — never pure black) |
| `card` / `secondary` | `#DCEBE2` | Card surfaces, secondary backgrounds (pale mint) |
| `muted` | `#E5EFE8` | Muted backgrounds |
| `panel` | `#D2E2D7` | Slightly deeper panels |
| `primary` / `accent` / `ring` | `#2E7D5B` | Buttons, links, focus rings, brand accents (forest-mint) |
| `primary-foreground` | `#F1F6F2` | Text on primary buttons |
| `muted-foreground` | `#4F6B5F` | Secondary/supporting text (muted sage) |
| `border` / `input` | `#C8DCD0` | All borders, inputs, dividers (soft mint) |

Border radius scale: `--radius: 0.75rem` (12px) base. `sm` = 8px, `md` = 10px, `lg` = 12px, `xl` = 16px. Cards use `rounded-xl` (12px), zone containers use `rounded-2xl` (16px), buttons use `rounded-lg` (10px), pill tags use `rounded-full`.

## Typography

**Fonts (load via `next/font/google` or equivalent):**
- `Inter` — body, UI, buttons (sans-serif, default)
- `Lora` — reserved for editorial/serif moments (rarely used; available)
- `Geist Mono` — code, data, technical readouts

Apply `font-sans antialiased` on `body`. Set CSS variables `--font-inter`, `--font-lora`, `--font-geist-mono`.

**Type scale (use these exact patterns):**

| Role | Classes |
|---|---|
| Hero H1 | `text-3xl md:text-4xl font-semibold tracking-tight leading-tight` |
| Section H2 (editorial) | `font-semibold text-sm tracking-wide uppercase mb-3` (foreground color) |
| Section eyebrow / kicker | `text-primary text-sm font-medium tracking-wide uppercase` (often paired with an `8px × 1px` primary-color rule: `<span className="w-8 h-px bg-primary" />`) |
| Card title (H3) | `font-semibold text-sm leading-snug` |
| Body paragraph | `text-sm leading-relaxed text-muted-foreground` |
| Tiny label / "Known as" | `text-xs uppercase tracking-[0.2em]` (muted-foreground) |
| Pill tag | `text-[10px] uppercase tracking-wider` inside `bg-secondary border border-border rounded-full px-2 py-0.5` |
| Nav link | `text-sm text-muted-foreground hover:text-foreground transition-colors duration-200` |

**Rules:**
- Headings: `font-semibold` (never `font-bold`). Use `tracking-tight` for large display, `tracking-wide uppercase` for small section labels.
- Body copy: `text-muted-foreground` by default, `text-foreground` only for emphasized lines.
- Never use pure black (`#000`) or pure white (`#fff`) — always the warm tokens.
- Italics (`<em>`) are fine for inline emphasis inside body text.

## Buttons

**Primary button** (the only button style that exists — keep it scarce, 1–2 per view max):
```
inline-flex items-center gap-2
bg-primary text-primary-foreground
text-sm font-medium
px-4 py-2 rounded-lg
hover:bg-primary/90
transition-colors duration-200
```

**Rules:**
- No outline/ghost/destructive variants unless you have a real reason.
- Padding is always `px-4 py-2` for standard, `px-2.5 py-1` for pill chips. Don't invent intermediate sizes.
- Icons inside buttons: `gap-2`, icon size 16px, same color as button text.
- Hover = `bg-primary/90` only. No scale, no lift, no shadow on hover.
- All transitions: `duration-200` and only on `colors` (or `all` for cards). Never animate longer than 300ms.

## Cards

```
flex flex-col gap-3
bg-card border border-border rounded-xl
p-5 (or p-6 for emphasis)
hover:bg-[#C2D6C9] hover:shadow-[inset_0_2px_6px_rgba(0,0,0,0.08)]
transition-all duration-200
```

- Hover effect is an **inset** shadow (subtle press-in), not a lift. This is intentional.
- Card internal spacing: `gap-3` between elements, `pt-3 mt-1 border-t border-border/60` for a divider line within a card.
- Tags inside cards: top-right, pill style (`text-[10px] uppercase tracking-wider bg-secondary border border-border rounded-full px-2 py-0.5`).

## Layout & Spacing

- **Max content width:** `max-w-5xl mx-auto` (≈ 1024px). Never go wider for prose/content.
- **Horizontal padding:** `px-6` on all sections.
- **Section vertical padding:** `pt-20 pb-16` for hero, `pb-16` or `pb-24` for sections. Generous.
- **Grid gaps:** `gap-4` (cards in grid), `gap-6` (hero columns), `gap-8 md:gap-10` (narrative columns).
- **Responsive breakpoints used:** `sm:` (cards 2-col), `md:` (nav, narrative 2-col), `lg:` (hero 2-col with sidebar).
- **Vertical rhythm:** `mb-2`, `mb-3`, `mb-6`, `mb-8`, `mb-12`. Stick to this scale; don't invent `mb-5` or `mb-7`.

## Navigation Bar

- Fixed top, full-width, `z-50`.
- Transparent at top of page; on scroll past 20px → `bg-background/90 backdrop-blur-md border-b border-border shadow-sm`.
- Inner container: `max-w-5xl mx-auto px-6 py-4 flex items-center justify-between`.
- Logo/wordmark: `text-sm font-semibold tracking-tight`.
- Mobile: hamburger toggle below `md`, full-width dropdown menu with `border-b border-border`.

## Borders & Dividers

- Default border: `border border-border` (the soft mint `#C8DCD0`).
- Subtle internal dividers: `border-border/60` (60% opacity for softer separation).
- Horizontal rules: `<hr className="border-t border-border" />`.
- Focus ring: `--ring: #2E7D5B` (primary color).

## Decorative Patterns (use sparingly)

- **Zone containers** that group related cards use a subtle dot pattern background:
  ```
  backgroundImage: 'radial-gradient(circle, rgba(43, 43, 43, 0.08) 1px, transparent 1px)',
  backgroundSize: '18px 18px',
  backgroundColor: 'rgba(241, 233, 221, 0.35)',
  ```
  Wrapped with `rounded-2xl border border-border/60 p-5 pt-12 md:p-8`.
- **Zone label:** absolute-positioned pill at `top-3 left-4`, `text-[10px] uppercase tracking-[0.15em] font-semibold` on `bg-background/90 border border-border/60 rounded-full px-2.5 py-1`.

## The "Don't" List

- No dark mode.
- No gradients (other than the dot-pattern zones above).
- No drop shadows on hover (use the inset shadow on cards, `shadow-sm` only on scrolled nav).
- No emojis in UI copy.
- No bold (`font-bold`) — `font-semibold` is the heaviest weight.
- No pure black, pure white, or any non-palette color.
- No animation longer than `duration-300`. No bouncing, scaling, or rotating on hover.
- No `text-base` or larger for body — body copy is `text-sm` with `leading-relaxed`.
- No more than ~2 primary buttons per page. Scarcity = signal.

## Tailwind / shadcn Setup

- Tailwind CSS v4, `@import 'tailwindcss'` syntax in globals.
- shadcn/ui "new-york" style if you use components.
- All colors and fonts wired through CSS variables in `:root` then exposed via `@theme inline` block — match the token names above (`--color-background`, `--color-primary`, etc.) so utility classes like `bg-card` and `text-muted-foreground` work.
- `html { scroll-behavior: smooth }` for in-page anchor links.

---

When in doubt: **fewer elements, more whitespace, smaller text, warmer tones.**
