# DriveCoding — Design System

**DriveCoding** (`drive-coding`) is a **voice-first, hands-free graphical interface
for ACP-compatible CLI coding agents** — Claude Code, opencode, gemini, and other
agents that speak the Agent Client Protocol. You talk; the agent codes; it talks
back. It is a SvelteKit PWA, **Hebrew-first / RTL**, dark-mode by default, and built
around a single guiding question: *"does this work with hands on the wheel and eyes
on the road?"*

The product's defining surface is the **agent chat**: a big central mic button that
drives a five-state voice loop, a stream of chat bubbles (user / agent thought /
tool calls / agent replies), and live status feedback — all readable at a glance and
audible via TTS.

## Sources

This system was reverse-engineered from the product's own frontend code. If you have
access, read these to go deeper:

- **GitHub:** [`MusiCode1/drive-coding`](https://github.com/MusiCode1/drive-coding) (branch `dev`) — the monorepo.
  - `docs/frontend-spec.md` — the canonical UX spec (drive-first principles, mic
    state machine, bubbles, car mode). The single best document to read.
  - `packages/frontend/src/app.css` — the live token source (the 8 palettes).
  - `packages/frontend/src/lib/components/chat/` — the real Svelte components
    (`MicLarge`, `RecordFooter`, bubbles, `Avatar`).
  - `packages/frontend/src/routes/+page.svelte` — the connect screen.

> The product is built in Svelte; this design system re-expresses its primitives as
> framework-agnostic React + CSS tokens so design tools can compose them.

---

## CONTENT FUNDAMENTALS

**Language.** Hebrew-first, RTL. All UI copy is Hebrew; code, paths, CLI names, and
terminal output stay LTR (and monospace). An i18n layer supports English, but Hebrew
is the design target — lay everything out RTL.

**Voice & person.** Direct, calm, second-person, and — notably — **addressed to the
user in feminine singular** (the product's convention): *"לחצי על הכפתור כדי לדבר"*
("tap the button to talk"), *"בחרי CLI ותיקיית עבודה"* ("choose a CLI and working
directory"). Keep that voice when writing new Hebrew copy.

**Tone.** Functional, reassuring, never chatty. Status messages are short present-
tense verbs: *"מקליט…"* (recording), *"מעבד…"* (processing), *"מקריא תשובה"* (reading
the answer), *"מתחבר מחדש… (ניסיון 2)"* (reconnecting, attempt 2). The agent's own
replies are concise and task-focused.

**Casing & punctuation.** Hebrew has no case. Latin tokens are lowercase (`claude`,
`opencode`, `pnpm dev`). Ellipsis `…` marks in-progress states. No exclamation
marks, no marketing voice.

**Errors.** Plain and specific, in a red-tinted banner: a short Hebrew sentence plus
the raw reason in monospace (e.g. *"הסוכן קרס"* + the crash stack). Never a modal —
errors appear inline.

**No modals, no `confirm()`.** A drive-first rule: destructive actions use an inline
*"בטוח?"* (sure?) with confirm/cancel buttons, never a browser dialog.

**Emoji.** Used sparingly and functionally, not decoratively — a 💭 prefix once marked
thought bubbles, 🚗 marks car-mode, 🧪 tags dev fixtures. The redesign replaced most of
these with Lucide icons. **Prefer Lucide icons over emoji** in new work.

---

## VISUAL FOUNDATIONS

**Overall vibe.** Warm, dark, focused, tactile. Near-black backgrounds with a single
warm accent; large soft-cornered surfaces; generous touch targets. It should feel
like a calm cockpit, not a busy IDE.

**Color.** Dark-mode-first. The product ships **8 runtime themes** switched via
`[data-palette]` on `<html>`; **ember** (warm copper/terracotta `#e8845c` on
`#16130f`) is the default and matches the app icon. Every theme defines the same
token contract: three surfaces (`--bg` → `--bg-elev` → `--bg-card`), three text
levels (`--fg` → `--fg-dim` → `--fg-muted`), translucent borders
(`--border` / `--border-str`), an accent trio (`--accent` / `--accent-hi` /
`--accent-soft`), two bubble fills, and three **voice-state** colors
(`--recording` red, `--thinking` purple, `--speaking` amber/green). Build with tokens
only — never hardcode hex. Tool-status dots (grey/orange/green/red) are the one fixed-
semantic exception, identical across themes.

**Type.** **Heebo** — a clean geometric Hebrew + Latin sans — at 300–800. The UI is
dense and voice-first, so body text sits at **14px**, secondary at 13px, meta at
~11px; titles climb to 22–36px. Monospace (JetBrains Mono / `ui-monospace`) for paths,
code, tool args, terminal output — always forced LTR + left-aligned even inside RTL.

**Backgrounds.** Flat solid surfaces — **no gradients, no images, no patterns,
no textures.** Depth comes from the surface ladder (`bg` / `bg-elev` / `bg-card`) and
soft shadow, not from color washes.

**Corners & shapes.** Rounded but purposeful. Cards 14px; inputs/tool cards 12px;
bubbles 16px **with one flattened (4px) tail corner** pointing at the speaker (user
flattens the bottom-start corner, agent the bottom-end). The mic-card footer has a
28px top "sheet lip". Mic button, avatars, side controls, badges, and toggles are
fully round.

**Shadows / elevation.** Soft and mostly **upward** — the footer mic-card rises from
the bottom edge (`0 -10px 30px rgba(0,0,0,.28)`). The mic button carries a faint
accent glow. No hard drop shadows, no neumorphism.

**Borders.** Hairline and translucent (`rgba(fg, 0.08)`), strengthening to `0.16` on
hover/focus. Dashed border + italic = a "thought" bubble.

**Cards.** `bg-elev` surface, 1px translucent border, 14px radius; interactive cards
lift to `bg-card` and `translateY(-1px)` on hover.

**Motion.** Short and eased, **no bounce**. `cubic-bezier(0.4,0,0.2,1)`; press/hover
~0.15s, color ~0.2s, state crossfade/layout ~0.3s. The mic crossfades its background
between state colors over 0.3s. Signature loops are tied to *meaning*: `pulse-rec`
(recording halo), `spin` (thinking/transcribing), `pulse-dot` (in-progress status),
`flash-fast` (cancelling). The wake-word orb scales with mic loudness in real time.
Avoid decorative infinite animation on idle content.

**Hover / press.** Hover: primary buttons lighten to `--accent-hi`; ghost buttons
gain an `--accent-soft` wash; cards/borders strengthen. Press: `scale(0.97)` on the
mic. Disabled: muted background + `opacity 0.6`, `not-allowed` cursor.

**Transparency & blur.** Sparingly — `color-mix(... transparent)` tints for avatars
and badges; translucent borders. No glassmorphism / backdrop-blur in the core UI.

**Layout rules.** Full-height app shell, `100dvh`, document never scrolls — only the
chat list does (smooth, with an auto-scroll + jump-down affordance). Fixed header
(flex-shrink 0) + flexible chat (flex 1) + fixed footer. Touch targets ≥ 44px, the
hero mic is 110px. Drive-first: one big central control, high contrast, large text.

---

## ICONOGRAPHY

**System.** The product uses **[Lucide](https://lucide.dev)** (via `@lucide/svelte`),
outline style, at **stroke-width 1.75** (1.5 for the large mic glyph), inheriting
`currentColor`. This design system ships `Icon` — a self-contained React component
carrying the exact Lucide path data for the curated set the UI actually uses, so
components need no icon dependency.

**Curated set.** `mic`, `mic-off`, `volume-2`, `square`, `loader`, `x`, `send`
(voice loop); `user`, `sparkles`, `brain`, `wrench` (chat avatars); `copy`, `check`,
`play`, `folder`, `keyboard`, `eye-off`, `chevron-down`, `settings`, `plus`,
`trash-2`, `refresh-cw`, `car` (actions/nav). Need another? Pull it from Lucide at
the same 1.75 weight and add it to `components/core/Icon.jsx`.

**Avatars.** Each chat role maps to a Lucide glyph on a soft tint: user→`user`,
agent→`sparkles`, thought→`brain` (on a `--thinking` tint), tool→`wrench`.

**Emoji & Unicode.** Mostly retired in favor of Lucide. A `$`-prefix marks shell
commands in tool output; ellipsis `…` marks progress. Don't introduce decorative
emoji.

**Logo / brand.** The app icon (`assets/logo-icon-512.png` and friends) fuses a
**play triangle** (run the agent) with a **voice waveform** (speak) in copper on
near-black — the visual root of the ember theme. Copies of all icon/favicon sizes
live in `assets/`.

---

## Index / manifest

**Root**
- `styles.css` — the single entry point consumers link (`@import`s only).
- `tokens/` — `colors.css` (8 palettes), `typography.css`, `spacing.css`
  (radius/shadow/motion/touch), `motion.css` (keyframes), `fonts.css` (Heebo via
  Google Fonts), `base.css` (resets).
- `assets/` — app icon, favicons, apple-touch icon.
- `SKILL.md` — Agent-Skills-compatible entry point.

**Components** (`window.DriveCodingDesignSystem_a6504a`)
- `components/core/` — `Icon`, `Button`, `IconButton`, `Avatar`, `Badge`,
  `StatusDot`, `Toggle`, `Select`, `TextInput`, `Card`.
- `components/chat/` — `ChatBubble`, `ToolCall`, `MicButton`, `StatusPill`.
- Each has a `.d.ts` (props) and `.prompt.md` (what/when + example). The card HTML in
  each directory shows the variants.

**UI kit**
- `ui_kits/drive-coding/` — the connect → live-chat PWA click-through, with the 8
  themes. See its `README.md`.

**Foundation cards** — `guidelines/*.html`, one specimen per concept, shown in the
Design System tab (Colors / Type / Spacing / Brand).

---

## Substitutions & notes

- **Heebo** is the real product typeface; it is loaded from **Google Fonts** (CDN)
  rather than self-hosted woff2 — consumers need network access at first paint. Ask
  the maintainers for the licensed font binaries if you need a fully offline build.
- Components are framework-agnostic React recreations of the product's Svelte
  components — visually faithful, cosmetically simplified (no real voice/WS pipeline).
