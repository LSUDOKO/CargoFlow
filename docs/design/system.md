# CargoFlow design system v2

Source of truth: `frontend/src/app/globals.css` (tokens) and `frontend/src/components/ui/*` (components).
Live reference: **`/design`** (internal, `noindex`, linked from nowhere) shows every token and component with states,
on paper and ink. Audit that motivated this: `docs/design/audit.md`.

Principles: navy, paper and one lime accent; calm surfaces, dense data; numbers line up; colour means something;
motion only acknowledges change. This is a refinement of the brand, not a new one.

---

## 1. Tokens

Tailwind 4 turns `@theme` variables into utilities. v1 names still work (aliases noted).

### Colour

| Group | Tokens (utility: `bg-*`, `text-*`, `border-*`, `ring-*`) | Use |
|---|---|---|
| Brand | `ink` #0B1B2B · `paper` #F7F9F4 · `signal` #C6F432 · `signal-2` (hover) · `signal-soft` (lime wash) · `signal-fg` #3D5A00 | Lime is for the one primary action, live/new markers and highlights. Lime text on light surfaces is always `signal-fg`, never `signal`. |
| Ink scale | `ink-950 … ink-100` (900 = ink; aliases `ink-2` = 800, `ink-3` = 700) | Navy surfaces (900/800), hairlines on navy (700), subtle text on light (`ink-500`, 6.0:1). 400 and lighter are decorative on light. |
| Neutrals | `neutral-0` white · `25` · `50` paper · `100` mist · `150` · `200` line · `300` · `400` · `500` slate · `600` · `700` · `900` | 0–150 surfaces, 200–300 borders, 400 icons/disabled (2.9:1, never body text), 500+ text. Aliases: `paper`, `mist`, `line`, `slate`. |
| Roles | `surface`, `surface-sunken`, `border`, `border-strong`, `border-ink`, `text`, `text-muted`, `text-subtle`, `text-on-ink`, `text-on-ink-muted`, `focus`, `focus-ink` | Prefer role tokens in new code: they say why. |
| Semantic (light) | `{success,warning,danger,info}` (solid mark) · `-solid` (filled, takes white; warning takes ink) · `-bg` · `-fg` · `-border` | fg on bg ≥ 5.3:1. Aliases: `verified` = success, `alert` = warning, `danger`. |
| Semantic (ink) | `{success,warning,danger,info}-bg-ink` · `-fg-ink` · `-border-ink` | fg-ink ≥ 10:1 on ink, ≥ 7.7:1 on its own bg. |

Rules: one accent per view; status colour only for status; never colour alone (pair with a dot, icon shape or word);
text ≥ 4.5:1 (`/design` prints every ratio). On navy, muted text is `text-paper/70` (8.5:1), never below `/55`.

### Type

Families: `font-display` Space Grotesk (headings, big numerals), `font-sans` Inter (everything read),
`font-mono` JetBrains Mono (**hashes, keys, code only**).

| Utility | Size / line-height / tracking / weight | Use |
|---|---|---|
| `font-display text-display` | clamp 40→68 / 1.02 / −0.04em / 700 | Landing hero only |
| `font-display text-h1` | clamp 32→44 / 1.08 / −0.03em / 700 | The page title (one per page) |
| `font-display text-h2` | 24 / 1.2 / −0.02em / 600 | Section titles, modal titles |
| `font-display text-h3` | 18 / 1.35 / −0.01em / 600 | Card titles |
| `font-display text-h4` | 16 / 1.4 / 600 | Sub-groups in a card |
| `text-body-lg` | 17 / 1.6 | Page description (lede) |
| `text-body` | 15 / 1.55 | Default copy in app pages |
| `text-small` | 13 / 1.45 | Secondary copy, hints, meta |
| `text-caption` | 12 / 1.35 / +0.01em | Footnotes, chart labels (minimum for running text) |
| `eyebrow` (class) | 11 / 600 / +0.08em / uppercase, muted | Label above a value or a title. Minimum size anywhere. |
| `font-display text-metric num` | clamp 28→36 / 1.05 / −0.03em / 600 | Headline numbers (Stat lg) |
| `num` (class) | tabular + slashed zero | **Every amount, count, percentage, time in a column** |

`.h-section` and `.lede` remain for the landing sections. Body copy max width: `max-w-reading` (42rem ≈ 70ch).

### Spacing

4 px base (Tailwind steps 1 = 4 px). Use the steps 1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 24 only.

| Variable | Value | Use |
|---|---|---|
| `--space-card` / `--space-card-sm` | 24 / 16 px | Card padding (`Card padded` = 16 → 24) |
| `--space-stack` | 16 px | Gap between cards in a column (`gap-4`) |
| `--space-section` | 40 px | Gap between page sections (`gap-10`) |
| `--space-page-y` | 40 → 48 px | Page top padding (`py-(--space-page-y)`) |
| `--gutter` | 16 / 24 (sm) / 32 (md) | Page side padding (`.container-page`) |

### Radius (four shapes)

`rounded-chip` 8 px (hash chips, kbd, small wells) · `rounded-control` 12 px (inputs, selects, menu items) ·
`rounded-tile` 12 px (tiles and wells inside a card, toasts, callouts, code) · `rounded-card` 20 px (cards, panels;
was 28) · `rounded-sheet` 24 px (modals, drawers, hero panels) · `rounded-pill` (buttons, tabs, badges).
Inner radius ≤ outer radius minus padding. No arbitrary radii.

### Elevation

`shadow-0` flat (sections, rows, sunken wells) · `shadow-1` resting cards and controls (alias `--shadow-card`) ·
`shadow-2` hover, menus, tooltips · `shadow-3` modals, drawers, toasts (alias `--shadow-lift`).
Shadows are navy-tinted and fall downward. A card has a border **or** a stronger shadow, not both at full strength.

### Borders and focus

1 px `border-border` default, `border-border-strong` for controls and dashed empty frames, `border-border-ink` on
navy. Buttons keep a 2 px border so filled and outline variants share metrics.
Focus: 2 px outline, 3 px offset, `--color-focus` (ink) on light, `--color-focus-ink` (lime) inside `.surface-ink`.
Never remove focus outlines; `Card tone="ink"` adds `.surface-ink` for you.

### Z-index

`--z-sticky` 20 · `--z-header` 40 · `--z-overlay` 50 · `--z-toast` 60 · `--z-tooltip` 70 (`z-(--z-overlay)`).

### Motion

| Token | Value | Use |
|---|---|---|
| `--duration-fast` | 120 ms | Hover, press, focus colour |
| `--duration-base` | 200 ms | Enter, tab switch, toggles |
| `--duration-slow` | 320 ms | Sheets, value updates, confirm |
| `ease-standard` | cubic-bezier(.2,0,0,1) | State changes |
| `ease-enter` | cubic-bezier(.16,1,.3,1) | Things arriving |
| `ease-exit` | cubic-bezier(.4,0,1,1) | Things leaving |

One language, three verbs:
- **Enter** `animate-enter` (200 ms, 6 px rise + fade) for panels, toasts, dialogs; `animate-sheet-up/right/left` for sheets.
- **Update** `animate-update` (320 ms lime wash fading out) when a live value changes. Use `useValueChange(value)`
  so it never fires on first paint or on re-renders with the same value. `Stat` does this for you.
- **Confirm** `animate-confirm` (320 ms settle, no bounce) on the element that confirms success (a released badge).

Rules: animate `transform` and `opacity` only (plus background for update); no staggered page-load cascades in the
app; nothing loops except `animate-pulse-dot` on live indicators and skeleton pulse. `prefers-reduced-motion`
removes all animation and transition durations globally; state is still conveyed by colour and text.
`animate-rise` (500 ms) is v1, for landing sections only.

---

## 2. Layout

- **Container**: `.container-page` (max 1280 px = `max-w-page`, gutter 16/24/32). `.container-wide` (1440 px) for map-first views.
- **Grid**: `.grid-12` (12 columns, 16 px gaps, 24 px from md). Common spans: 8/4 detail, 3×4 stats, 6/6 pairs.
- **Breakpoints**: Tailwind defaults (sm 640, md 768, lg 1024, xl 1280). Check every page at 390, 768, 1440.
- **Never overflow**: grid and flex children that hold text get `min-w-0` (Card has it). Long values truncate
  (`CopyField`) or scroll inside their own focusable region (`CodeBlock`, `DataTable maxHeight`, `Timeline` horizontal).
- **Don't stretch**: side-by-side cards of different length use `items-start` unless their bottoms must align.
- **Touch**: interactive targets ≥ 44 px on phones (Button md, IconButton md); sm/xs only in dense desktop rows.

## 3. Page templates

**A. App page** (Fleet, Market, portals, Developers, Deployments, eBL)
```tsx
<div className="container-page py-(--space-page-y)">
  <PageHeader eyebrow="Financing market" title="Fund cargo that proves itself"
    description="One sentence." actions={<><Button variant="secondary">…</Button><Button>Primary</Button></>} />
  <div className="flex flex-col gap-10">{/* Sections */}</div>
</div>
```
One h1, one primary action (or none), description ≤ 2 lines at 1440. No hero card, no illustration bigger than 48 px.

**B. Two-column detail** (shipment, bill, request, party)
Header panel (navy `rounded-sheet` allowed here) → `Tabs variant="underline"` for sections → `grid lg:grid-cols-12 gap-4`
with main `lg:col-span-8` (map, timeline, evidence, tables) and aside `lg:col-span-4` (status, terms `KeyValue`,
parties `CopyField`, actions). Aside is short facts; anything long or scannable goes in the main column.

**C. Dashboard grid** (Fleet, portal home when signed in)
`Section` with actions → stat row `grid grid-cols-2 lg:grid-cols-4 gap-4` of `Stat` → `Card padded={false}` holding a
`DataTable` → optional aside. Zero states collapse into an `EmptyState`, not four "0" tiles.

---

## 4. Components

All in `src/components/ui/`, typed, keyboard-accessible, unit-tested in `ui.test.tsx`.

| Component | API (main props) | Use when |
|---|---|---|
| `Button` | `variant: primary\|ink\|secondary\|ghost\|inverse\|danger\|danger-outline`, `size: xs\|sm\|md\|lg`, `loading`, `loadingText`, `icon`, `iconEnd`, forwards ref | Any action. One `primary` per view; `ink` when lime would compete; `inverse` on navy; `danger-outline` opens a confirm whose button is `danger`. |
| `IconButton` | `label` (required, accessible name + title), `variant`, `size`, `loading` | Icon-only actions (close, download, menu). |
| `LinkButton` | `href`, `external`, `variant`, `size`, `icon`, `iconEnd` | Navigation that looks like a button. |
| `buttonClass(v, s, cls, iconOnly)` | | Styling a non-button element as a button. |
| `Card` / `cardClass()` | `tone: white\|paper\|ink\|sunken`, `elevation: 0\|1\|2`, `padded: true\|false\|"sm"\|"md"\|"lg"`, `interactive`, `as` | Grouping related content. `sunken` for wells inside a card. Don't nest white cards. |
| `CardHeader` | `title`, `description`, `children` (trailing meta/actions), `as: h2\|h3` | Title row inside a card. |
| `PageHeader` | `title`, `description`, `eyebrow`, `actions`, `back`, `meta` | Top of every app page (template A). |
| `Section` / `SectionHeader` | `title`, `description`, `eyebrow`, `actions`, `as` | A labelled page section (`<section aria-labelledby>`). |
| `Badge` | `variant: success\|warning\|danger\|info\|neutral\|ink\|signal`, `size: sm\|md`, `shape: pill\|square`, `dot`, `pulse`, `onDark`, `icon` | Status (pill) or category/tag (square). |
| `Pill` / `StatusPill` | v1: `tone: verified\|alert\|ink\|danger\|slate\|info`; `StatusPill status` keeps `data-testid="status-pill"` | Existing call sites; facility status. |
| `Tabs` / `TabPanel` | `tabs: {id,label,count?,disabled?}[]`, `value`, `onChange`, `label`, `variant: segmented\|underline`, `size: sm\|md\|lg`, `idBase`, `scroll`, `controls` | Segmented for filters; underline for page sections. Give each tab set on a page its own `idBase`; `controls={false}` when no panel is rendered. |
| `Stepper` | `steps: {id,label,description?}[]`, `current`, `done?(i)`, `orientation`, `label` | Wizards only. |
| `Timeline` | `items: {id,title,eyebrow?,description?,time?,state,meta?}[]`, `state: done\|active\|held\|failed\|pending`, `orientation: vertical\|horizontal`, `label`, `showState`, `onDark` | Milestones, journeys, recovery history, audit summaries. |
| `DataTable<T>` | `columns: Column<T>[]` (`key, header, cell?, numeric?, align?, width?, primary?, hideOnCard?, cardLabel?, sortable?, sortValue?`), `rows`, `rowKey`, `caption`, `captionVisible`, `loading`, `loadingRows`, `empty`, `rowHref`, `density: compact\|regular`, `maxHeight`, `sort`/`onSortChange`, `cards` | Any list people scan or compare. Wrap in `<Card padded={false} className="overflow-hidden">`. Numbers: `numeric`. Whole-row links: `rowHref`. Under 640 px rows become cards (cells render twice; don't put ids inside cells). Sticky header applies inside its scroller, so pass `maxHeight` for long tables. |
| `Stat` | `label`, `value`, `unit`, `delta: {value, direction: up\|down\|flat, good?, context?}`, `hint`, `chart`, `size: sm\|md\|lg`, `onDark`, `loading`, `tile` | One headline number. Colour of delta follows `good`, not direction. |
| `Sparkline` | `values`, `label` (makes it an img), `width`, `height`, `tone`, `area`, `band` | Word-sized trend in Stat or a table cell. Use a real chart when values must be read. |
| `KeyValue` | `items: {label,value,hint?,numeric?,id?}[]`, `layout: inline\|stacked\|grid`, `columns`, `labelWidth`, `onDark`, `dense` | One record's fields (terms, waterfall, parties). |
| `CopyField` | `value`, `label`, `kind: address\|tx\|hash\|text`, `chainId`, `display: short\|full`, `size: sm\|md`, `onDark` | Addresses, tx hashes, keys, URLs. Replaces HashBadge in new code (HashBadge stays for v1). |
| `CodeBlock` / `CopyButton` | `code`, `label` | Code and commands; scrolls inside, never widens the page. |
| `Kbd` | `keys?: string[]` or children, `onDark` | Shortcuts. |
| `Tooltip` | `content`, single focusable child, `side: top\|bottom`, `align`, `delay` | Supplementary hints on hover/focus (gauge "?", truncated labels). Never the only copy of essential info. |
| `Callout` / `Banner` | `variant: info\|success\|warning\|danger\|neutral`, `title`, `children`, `action`, `onDismiss`, `live: polite\|assertive`, `onDark`, `icon` | Callout: guidance inside content. Banner: page-wide condition (offline, wrong network). `live="assertive"` only for problems needing action now. |
| `EmptyState` | `title`, `description`, `icon`, `action`, `frame: dashed\|plain`, `size`, `as` | No data yet, or filters match nothing (action: "Clear filters"). |
| `Skeleton` / `SkeletonText` | `className` / `lines` | Loading, shaped like the content; set `aria-busy` on the container. |
| `Spinner` | `className` | Inside buttons only; elsewhere use Skeleton. |
| `Field` | `label`, `help`/`hint`, `error`, `suffix`, `prefix`, `optional`, `hideLabel` + input props | Text and number inputs. |
| `Select` / `Textarea` | same shell props + native props | Native select (keeps phone pickers); multi-line text. |
| `FormField` / `controlClass()` | render-prop `{id, describedBy, invalid}` | Custom controls in the same shell. |
| `Modal` | `open`, `onClose`, `title`, `description`, `size: sm\|md\|lg` (`wide` = lg), `footer` | A decision that blocks the flow. Primary action last in `footer`. |
| `Drawer` / `Sheet` | `open`, `onClose`, `title`, `description`, `side: right\|left\|bottom`, `size: md\|lg`, `footer` | Detail beside the page (Drawer); phone pickers (Sheet). |
| `useToast().toast` | `{tone, title, body?, href?, hrefLabel?, action?: {label,onClick}, duration?}` → id; `dismiss(id)` | Confirmation that something happened. Never for errors the user must fix (use inline error or Callout). |
| `StateIcon` | `kind: success\|warning\|danger\|info\|pending\|active\|held` | Shared state glyphs. |
| `Accordion`, `Portal`, `useDialog`, `useValueChange`, `cx` | | Utilities. |

### Usage rules (when to use which)
- **List of records → DataTable.** One record → KeyValue. One number → Stat. Sequence over time → Timeline. Wizard → Stepper.
- **Message placement**: field problem → `Field error`; section state → `Callout`; whole app → `Banner`; it just happened → toast.
- **Overlays**: prefer inline UI; Drawer for "peek" detail; Modal only for confirm/short form; Sheet on phones for pickers.
- **Status**: `StatusPill` for facility status; `Badge square` for categories (device class, source); never more than two badges on one line.
- **Numbers**: `.num` everywhere numbers stack or update; unit after the value in muted small text (`Stat unit`, "USDG" column header).
- **Hashes**: `CopyField` (short form + copy + explorer); full form only where it is the subject of the page.

---

## 5. Migration checklist (page agents follow this per page)

1. Screenshot the page at 390, 768, 1440 before you start (compare with `docs/design/audit.md`).
2. Page shell: `.container-page py-(--space-page-y)`; replace the page's header with `PageHeader` (template A) or the
   detail template (B). One h1. One primary button.
3. Sections: wrap each in `Section` (or `SectionHeader` inside a Card); stack with `gap-10`.
4. Replace hand-rolled pieces:
   - tables / list rows → `DataTable` (numbers `numeric`, row links `rowHref`, empty → `EmptyState`, loading → `loading`);
   - stat tiles → `Stat`; label/value lists → `KeyValue`; milestone rails → `Timeline`;
   - hash chips / address + Copy + link → `CopyField`; notices → `Callout`/`Banner`; "nothing here" → `EmptyState`;
   - pills → `Badge`/`StatusPill`; inputs → `Field`/`Select`/`Textarea`; filter rows → `Tabs`.
5. Tokens, not literals: no hex colours, no `rounded-[…]`, no `text-[…px]`/`text-[…rem]`, no `shadow-[…]`. Map:
   `rounded-2xl`→`rounded-card` (cards) or `rounded-tile` (wells) or `rounded-control` (inputs);
   `rounded-[var(--radius-card)]`→`rounded-card`; `text-[0.8125rem]`→`text-small`; `text-[0.6875rem] uppercase tracking…`→`eyebrow`;
   `text-[#00733e]`→`text-success-fg`, `text-[#8a5300]`→`text-warning-fg`, `text-[#a1191e]`/`text-danger` (text)→`text-danger-fg`;
   `text-slate`→`text-text-muted`; `shadow-[var(--shadow-card)]`→`shadow-1`; `shadow-[var(--shadow-lift)]`→`shadow-3`.
6. Amounts in `.num` Inter, not `font-mono`. Mono stays for hashes, keys and code.
7. Every grid/flex child holding text: `min-w-0`. Side-by-side cards: `items-start` unless bottoms must align.
8. Motion: remove `animate-rise` from app pages (keep on landing); use `Stat`/`useValueChange` + `animate-update` for live values; `animate-confirm` on the success element after a transaction.
9. Keep every label, heading text, button name and `data-testid` that `frontend/e2e/*.ts` uses (grep the specs and
   `e2e/helpers.ts` for `getByRole`/`getByLabel`/`getByText`, e.g. "Connect wallet", "Continue", "Sign and submit", "View dashboard",
   "Find a shipment", "Search shipments", "Clear filters", tab names "All"/"Settled", `status-pill`). Copy meaning stays.
10. Verify: no horizontal scroll at 390/768/1440 (`document.documentElement.scrollWidth`), axe serious/critical clean,
    `pnpm exec tsc --noEmit`, `pnpm exec eslint src e2e`, `pnpm exec vitest run`.

Known shared items for the owner of `components/layout/*`: header overflow at 768 (audit X1), unreadable network
chip (X9), footer link farm (X10).
