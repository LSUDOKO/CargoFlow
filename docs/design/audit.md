# CargoFlow UI audit (2026-10-03)

Live site, https://cargoflow.adoranto737.workers.dev, captured with Playwright at 390, 768 and 1440 px (full page).
Screenshots: `/tmp/claude-1000/-home-arpit-Desktop-hackathon-projects-CargoFlow/45772ef8-6504-4b33-8b81-937635b28fa8/scratchpad/audit/`
(`<route>-<width>.png`, tiles in `view/`; track tabs as `track-<tab>-<width>.png`).
Benchmarks held in mind: Stripe Dashboard (density, tables, numerals), Mercury (calm surfaces), Linear (precision,
restrained motion), Flexport / project44 (maps, shipment timelines).

Severity: **P0** broken or inaccessible, **P1** visibly below a top-tier product, **P2** polish.
"DS" names the design-system v2 piece that fixes it (see `system.md`).

## Cross-cutting findings (fix once, everywhere)

| # | Sev | Finding | Fix |
|---|-----|---------|-----|
| X1 | P0 | **Horizontal scroll at 768 px on every page**: the header's right cluster (network chip + Find a shipment + Connect wallet + menu button) is 36 px wider than the viewport; the page is 804 px wide. | `components/layout/Header.tsx`: hide the network chip and the "Find a shipment" label below `lg`, or switch to the mobile menu below `lg` (not only below `md`). |
| X2 | P0 | **/docs is 946 px wide on a 390 px phone** (and 962 px at 768): a long code line in `CodeBlock` widened its grid/flex parent. | Fixed in the kit: `CodeBlock` now has `contain: inline-size` and a focusable, scrollable `<pre>`. Verified: /docs 390 has no overflow. |
| X3 | P1 | **Four different page-header styles**: Fleet (bare 60 px h1), Market/Developers/Deployments (eyebrow + 56 px h1), portals (h1 with lime marker inside a white hero card + illustration), track (navy hero card). Action buttons align to different baselines. | DS `PageHeader` for every app page; hero panels only on `/` and the shipment header. |
| X4 | P1 | **Radii are not a system**: 21 distinct radius values in use (125× `rounded-2xl`, 123× `rounded-full`, 33× `--radius-card` 28 px, plus 1.5rem, 2rem, 2.5rem, 28px literals). 28 px cards read bubbly next to 16 px inputs and 8 px chips. | DS radius scale: chip 8, control/tile 12, card 20, sheet 24, pill. `--radius-card` is now 20 px site-wide. |
| X5 | P1 | **Type sizes drift**: 28 arbitrary sizes (`text-[0.8125rem]`, `[0.6875rem]`, `[11px]`, `[10px]`, `[9px]`, `[10.5px]`, `[0.98rem]`, `[1.02rem]`…). 9–10 px text exists. | DS type scale (`text-display`…`text-caption`, `eyebrow`); nothing below 11 px. |
| X6 | P1 | **Money in monospace**: amounts ("30 USDG", "20 / 20", "40,000 USDG") are set in JetBrains Mono, so figures read as code and columns look like a terminal. | `.num` (Inter, tabular, slashed zero) for amounts; mono only for hashes, keys and code. |
| X7 | P1 | **Every card has border + shadow**, and cards nest inside cards (track overview: card → sunken tiles → pills). Surfaces feel heavy rather than calm. | Elevation 0–3: resting cards are level 1 (hairline), level 2 only on hover/menus, level 3 overlays. `Card tone="sunken"` for wells. |
| X8 | P1 | **Mobile tab rows clip with no affordance**: Fleet filters cut off "All"; track section tabs cut off "Documents & alerts" and "Audit trail" (only a hard edge hints at more). | DS `Tabs` now scroll sideways inside their own scroller with focus-ring padding; underline variant for page sections. |
| X9 | P1 | **Header network chip is unreadable**: "Robinhood Chain Testnet" in dark green-grey on navy (≈2:1). It passes axe only because axe skips it. | Use `Badge onDark variant="success" dot` or paper/70 text (8.5:1). |
| X10 | P1 | **Footer is a 5-column link farm**: 18 links; at 768 the columns squeeze to 2–4 words per line; on phones it is 1,200 px of links. | Collapse to 3 groups on md, accordion or two-column list on phones. |
| X11 | P1 | **Danger text and danger buttons fail contrast**: `text-danger` (#E5484D) on white is 3.9:1; white on `bg-danger` is 3.9:1. Field errors used it. | DS `danger-fg` (#A1191E, 6.6:1) for text, `danger-solid` (#C8323A, 5.3:1) for filled buttons. Field and Button now use them. |
| X12 | P2 | **Empty/zero states look like data**: Market shows four stat tiles all "0" / "–"; Fleet's single-row table leaves 300 px of blank page; party page shows three tall empty "No activity in this role yet." cards stretched to the first card's height. | DS `EmptyState`; collapse zero stats into one line; don't stretch grid items (`items-start`). |
| X13 | P2 | **Motion has no language**: `animate-rise` 500 ms on some panels, instant elsewhere; live values change without acknowledgement; nothing for confirmation. | DS motion: enter 200 ms, update 320 ms lime wash (only when a value changes), confirm 320 ms settle; reduced motion respected. |
| X14 | P2 | **Space Grotesk "1" in long ids** (CF-LIVE-1791029236301 at 48 px) reads as "7" and the flag makes numerals uneven. | Long ids in `text-h2` Inter semibold or mono at small size; reserve Space Grotesk for words and `text-metric`. |

## Per page (ranked by impact)

### / (landing)
1. P1 X1 header overflow at 768.
2. P1 Stat strip under the hero shows "1 / 0 / 6 / 1" with decorative vertical bars that look like a broken chart; numbers lack units and context. Use `Stat` with a hint line ("live, testnet").
3. P1 The track box overlaps the hero by 80 px but the hero image ends abruptly behind it; on 390 the overlap pushes the input below the fold.
4. P2 How-it-works cards: 28 px radius white cards on navy, giant + toggles; six equal cards (3×2) is the generic layout. Tighten radius to card (20) and use a numbered horizontal `Timeline` on desktop.
5. P2 Payout split bar labels (40% / 59%) at 11 px bold inside the bar; the 1% fee segment has no label.

### /shipments (Fleet)
1. P1 X3: bare h1 with an action floating mid-height, different from Market.
2. P1 Table is a header row outside a single rounded card row; "Capital drawn 20 / 20" has no unit; "Evidence" shows an unlabeled sparkline and a mono "100". Use `DataTable` with numeric columns ("Drawn (USDG)"), `Sparkline` + value, row link.
3. P1 X8 filter tabs clip on phones; sort select is half-width under a full-width search.
4. P2 300 px of empty canvas below one row; add a fleet stat strip (in transit, paused, capital drawn, average evidence) per the dashboard template.

### /market
1. P1 Four zero stat tiles dominate the page when there is nothing to fund (X12).
2. P1 Eyebrow + h1 + 3-line lede + right-aligned CTA at the lede's last line: action floats.
3. P2 Empty state is good in content but the dashed box is 330 px tall with a generic card icon.

### /exporter, /financier, /buyer, /arbiter (portals)
1. P1 Hero card (white, 28 px radius, shadow) holds only the h1 + lede + a small illustration at the far right; 200 px of white. Replace with `PageHeader` (illustration optional, small, left of title or omitted).
2. P1 "Connect your wallet" is a second full-width card with a lime button — the page's only content when signed out, yet styled like a secondary panel. Use a single `Callout` or an `EmptyState` with the primary action.
3. P2 Header nav label switches to the portal name ("Exporters", "Carriers") — good — but the dropdown pill highlight differs from Fleet/Market's active pill.

### /ebl
1. P1 Same hero-card pattern; the legal disclaimer sits between hero and form as an orphan grey line. Make it a `Callout variant="info"`.
2. P1 "Look up a bill" input is 1,040 px wide with the button outside the control; use a 36rem form width (`max-w-form`).

### /developers
1. P1 The navy "Add CargoFlow to Claude" panel stretches to the right column's height, leaving ~500 px of empty navy. `items-start` on the grid.
2. P1 Code blocks clip mid-word with the copy button overlapping text ("https://carg|Copy"). Copy now sits in its own column; long lines scroll in a focusable `<pre>`.
3. P2 Three button styles in one row (filled ink, two outlines) without a primary; "API reference" filled ink is not in the v1 kit (now `variant="ink"`).

### /docs
1. P0 X2 overflow on phones (fixed in `CodeBlock`).
2. P1 The embedded API reference (Scalar) brings its own type, radius and greys; 80 px of empty space above its sidebar. Theme it with the DS tokens (`--scalar-font`, `--scalar-radius`, colours) and remove the top padding.
3. P2 Base-URL card mixes three label styles (eyebrow, bold link, mono JSON).

### /deployments
1. P1 Contract table: address column is a mono link + Copy pill + "Verified source" pill per row — three competing chips; use `CopyField size="sm"` with explorer link and a single verified `Badge`.
2. P2 Row heights vary with description length (2-line wraps); give the description a max width and keep rows at 52 px where possible.
3. P2 "Contracts v3 · live" h2 with the deployer address floated right in 13 px mono — use `SectionHeader` actions slot.

### /parties/[address]
1. P1 Four role cards stretched to equal height; three are empty and 450 px tall (X12). Show only roles with activity, summarise the rest in one line.
2. P1 h1 is a 48 px mono shortened address; the full address repeats underneath in 11 px mono. Use `CopyField display="full"` once.
3. P2 Grade "A" tile: lime-green filled square with white "A" — check contrast (white on #00C46A is 2.3:1). Use `success-solid`.

### /track/[id] (overview)
1. P1 X14 + X6: the shipment id at 48 px Space Grotesk and mono amounts in the header.
2. P1 Two-column body is unbalanced: left column (map, ship) ends 1,100 px before the right column (ZK, evidence, gauges, cover, title, terms). Use the two-column template (8/4) with the long, scannable content in the main column and the short facts in the aside.
3. P1 "Journey" milestone rail repeats "Released · 3 Oct" seven times in green; use `Timeline orientation="horizontal"` with state shapes and one meta line.
4. P1 Three sunken tiles inside the overview card (cards inside cards). Use `KeyValue layout="grid"` without wells.
5. P2 Map legend has 10 items in two dense rows of 11 px text; group into "Route" and "Readings".

### /track tabs
- **Evidence**: P1 chart tick labels render at ~18 px (the SVG scales its text with width); P1 committed-evidence table mixes mono and sans and stacks two badges + a hash per row — use `DataTable` with a "Devices" column of square badges; P2 gauges are good but the "?" help dots need `Tooltip`.
- **Money**: P1 escrow "20" big number without unit next to "of 20 USDG drawn" in small text — use `Stat`; P1 lifecycle chips (Created → Settled) are six pills that look like filters, use a compact `Timeline`/`Stepper`; P2 the waterfall table uses mono amounts.
- **Documents & alerts**: P2 sparse; empty sub-sections each take a full card.
- **Audit trail**: P1 77 rows with time only (no date), CamelCase event names ("MilestoneAdvanceReleased · FinancingController"), a hash chip on every row: use `DataTable density="compact"` with a date+time column, humanised event names and `CopyField size="sm"`; P2 filter tabs inside the card duplicate the page tabs' style (use `Tabs size="sm"`).

## Accessibility snapshot
axe (wcag2a/aa, serious + critical) on the local build after the kit changes: clean on /, /shipments, /market,
/exporter, /financier, /buyer, /arbiter, /ebl, /developers, /docs, /deployments, /parties/…, /track/… and /design at
1440 and 390. Non-axe issues still open: X9 (header chip), parties grade tile contrast, X1 overflow.
