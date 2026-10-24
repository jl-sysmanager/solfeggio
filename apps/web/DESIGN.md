---
name: Solfeamos
description: Gestión integral para bandas de música — cobalt enamel plaques on cold glaze.
colors:
  cobalt-950: "#0E1A42"
  cobalt-900: "#16275E"
  cobalt-800: "#1C3577"
  cobalt-700: "#23408E"
  cobalt-100: "#E3E8F6"
  glaze: "#F3F5F8"
  ink: "#141A2E"
  white: "#FFFFFF"
  secondary: "#ECEEF3"
  muted-ink: "#545D73"
  muted-on-muted: "#4A5268"
  border: "#DCDFE6"
  input-border: "#7D869B"
  surface-alt: "#F8F9FB"
  chart-neutral: "#B9BFCC"
  ochre: "#D9A21B"
  ochre-ink: "#5A3E00"
  ochre-strong: "#8F6300"
  ochre-field-ink: "#241900"
  copper: "#2F7D5B"
  manganese: "#6B3F69"
  critical: "#B42318"
  plaque-muted: "#C9D4F2"
  sidebar-text: "#C9D3F0"
  sidebar-label: "#93A5D8"
  chip-success: "#DCEFE5"
  chip-success-ink: "#1F5A40"
  chip-warning: "#FBEFCF"
  chip-warning-ink: "#6E4C00"
  chip-danger: "#FBE1DE"
  chip-danger-ink: "#9B1C12"
  chip-school: "#EFE3EE"
  chip-school-ink: "#5A3358"
  night: "#0C1124"
  night-card: "#131A31"
  night-popover: "#182039"
  night-ink: "#E6E9F2"
  night-primary: "#8FA8F0"
  night-muted: "#1D2642"
  night-muted-ink: "#9DA6BF"
  night-muted-on-muted: "#A9B1C8"
  night-accent: "#23305A"
  night-critical: "#F0877C"
  night-copper: "#5CC195"
  night-copper-ink: "#04140D"
  night-ochre: "#E7B53E"
  night-ochre-ink: "#2A1D00"
  night-manganese: "#C99BC6"
  night-border: "#262F4D"
  night-input-border: "#5F6A8A"
  night-btn: "#3557C0"
  night-btn-hover: "#2D4AA8"
  night-sidebar: "#13225A"
  night-sidebar-panel: "#1B2D6E"
  night-surface-alt: "#10162B"
  night-tile-rehearsal: "#2D4FA8"
  night-tile-meeting: "#2B7A57"
  night-tile-school: "#8A5587"
  night-tile-empty: "#1A223D"
  night-chart: "#3A4466"
  night-chip-info: "#1E2A52"
  night-chip-info-ink: "#B8C7F5"
  night-chip-success: "#11301F"
  night-chip-success-ink: "#7FD6AE"
  night-chip-warning: "#33270A"
  night-chip-warning-ink: "#F0C866"
  night-chip-danger: "#3A1714"
  night-chip-danger-ink: "#F5A29A"
  night-chip-school: "#2E1D2D"
  night-chip-school-ink: "#DDB6DA"
typography:
  display:
    fontFamily: "Archivo, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "32px"
    fontWeight: 800
    lineHeight: 1.1
    letterSpacing: "-0.015em"
    fontVariation: "wdth 87.5"
  plaque:
    fontFamily: "Archivo, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "clamp(1.5rem, 2.4vw, 2rem)"
    fontWeight: 800
    lineHeight: 1.05
    letterSpacing: "normal"
    fontVariation: "wdth 80"
  headline:
    fontFamily: "Archivo, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "24px"
    fontWeight: 800
    lineHeight: 1.15
    letterSpacing: "-0.01em"
    fontVariation: "wdth 87.5"
  title:
    fontFamily: "Archivo, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "20px"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "-0.005em"
    fontVariation: "wdth 87.5"
  body:
    fontFamily: "Archivo, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
    fontVariation: "wdth 100"
  label:
    fontFamily: "Archivo, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "11px"
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: "0.08em"
    fontVariation: "wdth 100"
rounded:
  sm: "4px"
  md: "6px"
  lg: "10px"
  full: "9999px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "5": "20px"
  "6": "24px"
  "8": "32px"
  "10": "40px"
  "12": "48px"
components:
  button-primary:
    backgroundColor: "{colors.cobalt-700}"
    textColor: "{colors.white}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    height: "38px"
  button-primary-hover:
    backgroundColor: "{colors.cobalt-800}"
    textColor: "{colors.white}"
  button-ghost:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    height: "38px"
  button-ghost-hover:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.ink}"
  button-danger:
    backgroundColor: "{colors.glaze}"
    textColor: "{colors.critical}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    height: "38px"
  button-on-plaque:
    backgroundColor: "{colors.glaze}"
    textColor: "{colors.cobalt-900}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    height: "38px"
  input:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "38px"
  chip-warning:
    backgroundColor: "{colors.chip-warning}"
    textColor: "{colors.chip-warning-ink}"
    rounded: "{rounded.full}"
    padding: "2px 8px"
  nav-active:
    backgroundColor: "{colors.glaze}"
    textColor: "{colors.cobalt-900}"
    rounded: "{rounded.md}"
    padding: "7px 8px"
    height: "36px"
  card:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "20px"
  stat:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "16px 20px"
  plaque:
    backgroundColor: "{colors.cobalt-700}"
    textColor: "{colors.white}"
    typography: "{typography.plaque}"
    rounded: "{rounded.lg}"
    padding: "24px"
  week-tile-rehearsal:
    backgroundColor: "{colors.cobalt-700}"
    textColor: "{colors.white}"
    rounded: "{rounded.md}"
    padding: "8px"
  week-tile-performance:
    backgroundColor: "{colors.ochre}"
    textColor: "{colors.ochre-field-ink}"
    rounded: "{rounded.md}"
    padding: "8px"
  week-tile-meeting:
    backgroundColor: "{colors.copper}"
    textColor: "{colors.white}"
    rounded: "{rounded.md}"
    padding: "8px"
  week-tile-school:
    backgroundColor: "{colors.manganese}"
    textColor: "{colors.white}"
    rounded: "{rounded.md}"
    padding: "8px"
  week-tile-empty:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.muted-ink}"
    rounded: "{rounded.md}"
    padding: "8px"
---

# Design System: Solfeamos

## Overview

**Creative North Star: "Azulejo y placa esmaltada"**

Solfeamos is the seat of a Spanish community wind band, rendered as glazed tile and enamel plaque. The page is cold white glaze. The rail is deep cobalt. White cards sit on that glaze with a 1px edge. When a screen has one fact the board or the musician must read first, that fact is a cobalt plaque with a light inner fillet. Inicio is the reference composition: a page title, the next-call plaque ("Ver convocatoria"), a row of figures, the week as seven tiles, and a "Pendiente" card.

The interface is dense enough for a volunteer board at a desk and direct enough for a musician on a phone. Color is flat enamel. Each enamel has one semantic job, and the agenda reuses those same enamels for event types. Archivo is the only text family; a width axis tightens titles and plaques, and figures that scan (money, dates, counts) are tabular. Confirmed rejections: the generic grey SaaS panel with a single blue accent, and musical-notation folklore (staff lines, clefs) as chrome.

Two facts stay open. The exact Solfeamos brand palette is not documented in this repo; the enamels below are the shipped interface, and they are not a logo specification. The platform logo is uploaded from the global panel and served from the brand API; until a logo is set, the mark is an S on a small plaque. Per-band colour templates are a confirmed requirement and are not built. No tenant palette ships. The planned seam, when that work is done, is the sidebar and plaque tokens only (`--sidebar-bg`, `--sidebar-active`, `--sidebar-panel`, `--sidebar-text`, `--plaque-bg`, `--plaque-text`, `--plaque-rule`, and the wordmark fillet).

**Key Characteristics:**

- Cobalt rail and cobalt plaque on a cold glaze ground
- One enamel, one job, reused as the agenda tile color
- Archivo width axis: 87.5% for titles, 80% for plaques, 100% for UI text
- Tabular figures for money, dates, counts, and day numbers
- Flat color, 1px edges, inner fillet on plaques
- 8px module with 4px half-steps
- Light and dark themes that keep the same enamel jobs
- WCAG 2.2 AA as the target: visible focus, keyboard path, reduced motion, 44px primary targets on narrow screens

## Colors

Cold glaze, deep cobalt, and four signal enamels. Cobalt is the only navigation and primary-action color. The others never substitute for it.

### Primary

- **Plaque Cobalt** (`#23408E`): primary buttons, links, the plaque field, rehearsal tiles, info chips, meters, and the focus ring on light surfaces. Pressed state is **Cobalt Pressed** (`#1C3577`).
- **Rail Cobalt** (`#16275E`): the navigation rail in light, the browser `theme-color`, and the sign-in panel. **Deep Cobalt** (`#0E1A42`) tints shadows and the dialog scrim.
- **Cobalt Wash** (`#E3E8F6`): info chips, icon wells, and the accent wash behind cool cards.

In dark, primary *text* and links switch to **Nocturnal Cobalt Text** (`#8FA8F0`) on the night ground. Primary *buttons* switch to **Nocturnal Button Cobalt** (`#3557C0`, hover `#2D4AA8`) with white text. The plaque field stays Plaque Cobalt in both themes.

### Secondary

- **Attention Ochre** (`#D9A21B`): pending, warning, and "needs a look." Performance tiles, due dates, the rail count, selection wash (35% ochre), and the focus ring on cobalt (rail and plaque).
- Text on a solid ochre field uses **Ochre Field Ink** (`#241900`). Hint text on glaze uses **Ochre Strong** (`#8F6300`). Warning chips use **Chip Warning** (`#FBEFCF`) with **Chip Warning Ink** (`#6E4C00`). **Ochre Ink** (`#5A3E00`) is the warning-foreground token; it is about 4.3:1 on solid ochre, so it is not the ink for text sitting on the ochre field.

### Tertiary

- **Copper Green** (`#2F7D5B`): confirmed, paid, and success. Meeting tiles use the same enamel. Success chips are **Chip Success** (`#DCEFE5` / `#1F5A40`). White on copper is about 5:1.
- **School Manganese** (`#6B3F69`): school and only school. School chips are **Chip School** (`#EFE3EE` / `#5A3358`). Week tiles and the sign-in preview use it. The date mark on event lists does not yet apply it (see Week tiles).
- **Critical Red** (`#B42318`): destructive actions, error text, overdue rail counts, and danger chips (`#FBE1DE` / `#9B1C12`). White on this red is about 6.6:1.

### Neutral

- **Cold Glaze** (`#F3F5F8`): page background. **Plaque White** (`#FFFFFF`): cards, inputs, popovers. **Enamel Ink** (`#141A2E`): primary text. **Muted Ink** (`#545D73`): secondary text on glaze (about 6:1).
- **Tile Grout** (`#ECEEF3`): muted fills, empty week tiles in light, segmented tracks. **Ink On Grout** (`#4A5268`): text on that grout (about 6.7:1). Table headers use it.
- **Glaze Edge** (`#DCDFE6`): card, table, and top-bar borders. **Field Edge** (`#7D869B`): input borders, about 3.6:1 on white, so the field boundary clears the 3:1 non-text bar.
- **Cooler Glaze** (`#F8F9FB`): table header ground and the search field. **Chart Grout** (`#B9BFCC`): the neutral chart series.
- **Rail Text** (`#C9D3F0`) and **Rail Label** (`#93A5D8`) sit on Rail Cobalt (about 9.5:1 and 5.8:1). **Plaque Mist** (`#C9D4F2`) is secondary text on the plaque (about 6.5:1) and the dark plaque fillet.

Chips are a soft field plus a darker ink of the same enamel, with a 6px square pip. Info chips use Cobalt Wash and Cobalt Pressed. Avatar wells mix the enamel into the card at a low percentage.

### Dark

Dark follows the system when `prefers-color-scheme: dark` and the root is not `data-theme="light"`, and it also applies when the user menu sets `data-theme="dark"`. Setting `data-theme="light"` keeps the light enamels. The two paths carry the same color overrides.

- Ground **Nocturnal Ground** (`#0C1124`), cards **Nocturnal Card** (`#131A31`), popovers **Nocturnal Popover** (`#182039`), text **Nocturnal Ink** (`#E6E9F2`).
- Muted surfaces **Nocturnal Muted** (`#1D2642`); muted text **Nocturnal Muted Ink** (`#9DA6BF`); text on muted **Nocturnal Ink On Muted** (`#A9B1C8`).
- Borders **Nocturnal Edge** (`#262F4D`); field borders **Nocturnal Field Edge** (`#5F6A8A`), about 3.2:1 on the night card.
- Ochre, copper, manganese, and red retint through their *role* tokens: warning `#E7B53E`, success `#5CC195`, school `#C99BC6`, critical `#F0877C`. Chips and agenda tiles have their own night hexes in the frontmatter. The plaque stays `#23408E`; its fillet becomes Plaque Mist.
- The rail becomes **Nocturnal Rail** (`#13225A`), with the band panel at `#1B2D6E`. The active item becomes Plaque Cobalt with white text. Rail text and rail labels keep their light hexes.
- The light primitives `--ochre`, `--copper`, `--manganese`, and `--glaze` are not rewritten in dark. Role tokens (`--warning`, `--success`, `--school`, `--tile-*`, `--btn-bg`) are. The rail count still reads the light ochre primitive (see the divergence under Named Rules).

### Named Rules

**The Enamel Legend Rule.** Cobalt navigates and is the primary action. Ochre asks for attention and marks what is pending. Copper green means confirmed or paid. Manganese is school. Red is critical. Agenda tiles reuse those enamels for rehearsal, performance, meeting, and school. They do not introduce a new hue.

**The Ochre Field Rule.** Ochre is a field, never small text. Ochre on white is about 2.3:1. Text on solid ochre uses Ochre Field Ink. New attention UI uses the warning role so dark theme can retint it. The rail count still paints the unthemed `--ochre` primitive; that split is drift, and new counts should follow the warning role.

**The Dark Button Rule.** In dark, links and primary text use Nocturnal Cobalt Text. Primary buttons stay a saturated cobalt field with white text. A light-blue button on the night ground is the wrong cobalt.

## Typography

**Display Font:** Archivo (with system-ui, Segoe UI, sans-serif)
**Body Font:** Archivo, same stack, width axis at 100%
**Label/Mono Font:** Archivo for labels; ui-monospace, SFMono-Regular, Menlo, Consolas for keyboard hints only

**Character:** One family. The width axis does the work a second face would do: titles feel struck into a plaque, and interface text stays at a normal width. Archivo is loaded as a variable font on the `wdth` and `wght` axes (width 62.5–125, weight 400–800). Weights in use are 400, 500, 600, 700, and 800.

### Hierarchy

- **Display** (800, 32px, line-height 1.1, tracking −0.015em, width 87.5%): page titles in the page header. Below 768px the page title is 26px (1.625rem). Stat values use 32px at weight 700, same width, with tabular figures.
- **Plaque** (800, clamp(1.5rem, 2.4vw, 2rem), line-height 1.05, width 80%): the plaque title. The sign-in headline uses this same 80% width at clamp(2.25rem, 3.4vw, 3.25rem), line-height 1.02, white, max 12ch: "Toda tu banda, en un solo panel."
- **Headline** (800, 24px, line-height 1.15, tracking −0.01em, width 87.5%): a bare first-level heading outside the page header. The wordmark is 18px, weight 800, width 87.5%.
- **Title** (700, 20px, line-height 1.25, tracking −0.005em, width 87.5%): second-level headings. Card titles are a compact title: 15px, weight 800, width 87.5%.
- **Body** (400, 14px, line-height 1.5, width 100%): default interface text. Descriptions under the page title run up to 72ch. The sign-in lead is 15px. An explicit `data-theme="dark"` sets body line-height to 1.6; system dark leaves 1.5. The token stays 1.5.
- **Label** (700, 11px, tracking 0.08em, uppercase, width 100%): rail group labels, table headers, and the month on a date mark. Form labels are 14px, weight 500, sentence case.

Third-level headings are 15px and weight 700 at normal width. They skip the display width axis. Card titles are the pattern to copy for a titled block.

### Named Rules

**The Width Axis Rule.** Page titles, second-level headings, card titles, stat values, and the wordmark use Archivo at 87.5% width. Plaque titles and the sign-in headline use 80%. Body, labels, fields, and buttons stay at 100%.

**The Tabular Figures Rule.** Money, dates, counts, day numbers, rail counts, and numeric table columns use `tabular-nums`. A changing figure keeps its place.

## Layout

The shell is a two-column grid from 1024px: a 248px rail and a fluid main column capped at 1440px. Below 1024px the rail is off-canvas, 248px wide up to 85vw, under a 64px top bar. The top bar is white (or the night card), with a 1px bottom edge, a search field up to 28rem from 768px, and the user menu. Page sections stack with a 24px gap. The page header is a row from 768px: title and description on the left, actions on the right.

Structural space steps on the 8px module and its 4px half: 4, 8, 12, 16, 20, 24, 32, 40, 48. Container padding is 16px, and 24px from 768px. Cards pad 20px. Stat cards pad 16px 20px. Grids gap 16px; stat grids gap 12px. Auto-fill tracks use 280px, stat tracks 200px, and two-column tracks 380px. Below 640px stats become two columns, and a trailing odd stat spans both.

The reference page (Inicio) stacks the plaque, the stat row, then two columns: week tiles and the event list on the left, "Pendiente" and shortcuts on the right. Below the two-column breakpoint those stacks become one column. Event lists and data tables are the dense surface; the plaque is the one large field.

Narrow-screen adjustments that ship: primary buttons, text inputs, and segmented controls grow to 44px below 768px, and inputs use 16px type so the browser does not zoom. Week tiles drop the square ratio below 479px and keep a 64px minimum height. Tables become stacked cards below 720px. The sign-in split (cobalt panel plus form) starts at 960px; below that, the headline and preview hide and the panel is a short brand bar.

### Named Rules

**The Eight-Pixel Module Rule.** New structural space uses the module: 4, 8, 12, 16, 20, 24, 32, 40, 48. A few dense controls already use 6px, 7px, or 10px. Those local adjustments are not a second rhythm.

## Elevation & Depth

Resting surfaces are flat. Depth comes from the glaze-to-white step, the 1px edge, and the cobalt field of the rail and the plaque. Shadows are reserved for layers that float above the page.

### Shadow Vocabulary

- **Lift** (`box-shadow: 0 1px 2px 0 rgb(14 26 66 / 0.06)`): the selected segment in a segmented control. The same value exists for an elevated card utility that no screen uses.
- **Raised** (`box-shadow: 0 4px 10px -2px rgb(14 26 66 / 0.12)`): defined for an optional hover lift. No screen uses it.
- **Float** (`box-shadow: 0 16px 32px -8px rgb(14 26 66 / 0.22), 0 2px 6px rgb(14 26 66 / 0.08)`): menus, dialogs, toasts, the command palette, and the mobile drawer. In dark this becomes `0 16px 32px -8px rgb(0 0 0 / 0.5), 0 2px 6px rgb(0 0 0 / 0.3)`. Lift and Raised stay cobalt-tinted in dark.
- **Dialog scrim:** `rgb(14 26 66 / 0.45)`, Deep Cobalt at 45%.

The "today" week tile uses an inset 2px ring in the strong text color (`--text-strong`): dark page ink on a light-theme cobalt tile, light ink in dark theme. That is a mark, not a shadow. The sign-in card declares Float and then clears it; the shipped card is flat.

### Named Rules

**The Flat Enamel Rule.** Cards, the page, and the plaque rest flat. A drop shadow means the layer is floating (menu, dialog, toast, command palette, mobile drawer) or it is the selected segment's hairline lift. Gradients do not ship.

## Shapes

Corners in use are 4px for meter tracks and keyboard hints, 6px for buttons, fields, tiles, date marks, and nav items, 10px for cards, plaques, dialogs, and menus, and a full pill for chips, counts, avatars, and deltas. `--radius-xl` (12px) and `--radius` (0.5rem) are declared and unused. They are not corner steps.

The signature silhouette is the plaque: a cobalt rectangle with a 10px corner and a 1.5px inner fillet (an outline drawn inside the edge). The offset grows with the plaque: −4px on the wordmark S, −5px on the module mark and the sign-in mark, −6px on the page plaque. On the rail, the wordmark S flips to a glaze field, Rail Cobalt glyph, and Rail Cobalt fillet. Week tiles and date marks are glazed squares (date marks are 52px) with a 6px corner. Empty states use a dashed 1px edge.

### Named Rules

**The Inner Fillet Rule.** A plaque, a module mark, and the wordmark S carry a 1.5px inner fillet. That fillet is an outline with a negative offset, in glaze (light) or Plaque Mist (dark). A second border around the plaque is a different object.

## Components

### Buttons

Solid, 6px corners, 14px Archivo at weight 700, padding 8px 16px, 38px tall. The press scales to 0.98 over 100ms. Disabled is 50% opacity.

- **Primary:** Plaque Cobalt field, white text. Hover is Cobalt Pressed. In dark, follow The Dark Button Rule (`#3557C0` / `#2D4AA8`, white text).
- **On the plaque:** glaze field, Rail Cobalt text. Hover is white. The ghost-on-plaque variant is transparent, white text, and a white border at 45% (hover fills white at 10%).
- **Ghost:** white field, ink text, Field Edge border. Hover fills Tile Grout. This is the secondary action beside a plaque ("Nuevo ensayo" when a next call already exists).
- **Danger:** glaze field, Critical Red text, a red-tinted border. Hover washes red at 6%.
- **Focus:** 2px solid focus ring, 2px outside the control. On the plaque the ring is ochre.
- Below 768px primary and ghost buttons are 44px tall. Small buttons stay 32px (13px type, padding 6px 12px). Icon buttons are 36px, transparent, muted ink, grout on hover.

### Chips

Pills (full radius), 12px semibold, padding 2px 8px, with a 6px square pip. Neutral chips use Tile Grout and Ink On Grout. Info, success, warning, danger, and school each use their chip pair from the frontmatter. A chip with the pip suppressed is the plain count chip ("3/12 confirmados").

Toggle chips are buttons: white with a grout edge, and Plaque Cobalt with white text when pressed. On a plaque, every chip is forced to white at 14% on a white text color, so the enamel disappears.

### Cards / Containers

White (night card in dark), 10px corners, 1px Glaze Edge, 20px padding, no shadow. The header is a row: card title and optional action. Warm cards wash ochre at 6% with an Ochre Strong border at 30% (the "Amplía tu plan" prompt). Cool cards wash cobalt. A muted card uses Tile Grout.

Stat cards pad 16px 20px. The label is 12px semibold muted. The value is 32px, weight 700, width 87.5%, tabular. A warning hint uses Ochre Strong text and an 8px ochre square; a success hint uses Chip Success Ink and a copper square. The meter is a 6px grout track with a cobalt fill.

Empty states are centered, dashed 1px, with a 40px muted icon well. Skeletons pulse on Tile Grout.

### Inputs / Fields

38px tall, 6px corners, 14px type, padding 0 12px, white field, Field Edge border. Hover darkens the border to Muted Ink. Focus draws a 2px ring inset 1px and turns the border to the ring color (Plaque Cobalt in light, Nocturnal Cobalt Text in dark). Error borders are Critical Red, with 12px error text. Disabled is 50% opacity. Placeholders use Muted Ink. Below 768px the field is 44px and 16px type. Textareas start at 96px. Checkboxes are 16px with a cobalt accent.

Segmented controls sit on Tile Grout with 3px padding; the selected segment is a white card with the Lift shadow. Tab lists drop the track and use a 2px Plaque Cobalt underline.

### Navigation

The rail is Rail Cobalt (Nocturnal Rail in dark), sticky and full height from 1024px. Group labels are the label style in Rail Label. Items are 14px medium, 36px minimum, 6px corners, padding 7px 8px, Rail Text, with an 18px icon slot. Hover is white at 8%. The active item is a glaze plaque with Rail Cobalt text at weight 700 (in dark, Plaque Cobalt with white text). Focus on the rail is ochre, 2px.

The attention count is a 20px ochre pill, Ochre Field Ink, 11px weight 800, tabular. The overdue count uses Critical Red and white. The active band sits in a cobalt panel (Cobalt Pressed in light, `#1B2D6E` in dark) with a 10px corner.

The top bar holds the wordmark below 1024px, search ("Buscar…", keyboard hint in mono), the bell, and the user menu. Menus are night-or-white popovers, 10px corners, Float shadow, items 8px 12px. Destructive menu items are Critical Red.

### Plaque

The primary fact on a screen. Cobalt field, white text, 10px corners, padding 24px (24px 32px from 768px), 1.5px inner fillet. The title uses the plaque type style. Detail lines are Plaque Mist. Actions align to the end of the row from 768px. The reference plaque is the next call: title, type, datetime, place, and "Ver convocatoria" as an on-plaque button. Focus inside the plaque is ochre.

The module mark beside a page title is the same object at 44px (36px below 768px). The wordmark S is the same object at 32px.

### Week tiles

Seven squares in one row, 4px apart, each a 6px-corner tile with 8px padding. Empty days are Tile Grout with Muted Ink. A day with an event takes that event's enamel:

- Rehearsal: Plaque Cobalt, white text (dark tile `#2D4FA8`)
- Performance, and due dates on the date mark: Attention Ochre, Ochre Field Ink (dark tile `#E7B53E`)
- Meeting: Copper Green, white text (dark tile `#2B7A57`)
- School: School Manganese, white text (dark tile `#8A5587`)

The weekday is 12px semibold. The day number is 22px, weight 800, width 87.5%, tabular. The event name is 14px, weight 800, width 87.5%, single line. Today draws a 2px inset ring in the strong text color. Linked tiles brighten slightly on hover (brightness 1.08). The Inicio legend shows "Ensayo", "Actuación", and "Reunión". School is a real tile (the sign-in preview uses "Escuela") and is absent from that legend.

The date mark beside an event is a 52px tile of the same enamels: month in the label style, day number at 22px tabular. Cancelled dates use the empty tile, muted ink, and a strike-through. Other dates use the empty tile with ink text. The date mark has no school modifier, so a school date currently renders as rehearsal cobalt. Week tiles are the pattern that has the school enamel.

### Tables

Full width, 14px, header on Cooler Glaze. Header cells are the label style in Ink On Grout. Body cells pad 12px; the first and last pad 16px. Row hover mixes Tile Grout at 60% into the card. Numeric columns align right and use tabular figures. The actions column sticks to the right edge. Below 720px each row becomes a 10px card and each cell shows its column label.

### Sign-in

From 960px, a Rail Cobalt panel (minimum 440px, five parts) beside the form (seven parts). The panel carries the wordmark, the plaque-width headline, a lead, and ochre 8px squares as bullets. The form card is at most 440px, padding 32px 24px, 1px edge, flat. Its title is the display style at 32px.

## Do's and Don'ts

### Do:

- **Do** give cobalt the navigation, the primary button, the link, the rehearsal tile, and the plaque.
- **Do** use ochre for pending and warning, copper green for confirmed and paid, manganese for school, and red for destructive and overdue.
- **Do** set Archivo to 87.5% width on titles and 80% on plaques, and keep UI text at 100%.
- **Do** set tabular figures on money, dates, counts, day numbers, and numeric columns.
- **Do** keep resting cards flat, with a 1px edge and a 10px corner.
- **Do** draw the plaque fillet at 1.5px, inside the edge.
- **Do** show a 2px focus ring: cobalt on light surfaces, ochre on the rail and the plaque.
- **Do** grow primary buttons, fields, and segmented controls to 44px below 768px, and honor `prefers-reduced-motion` by dropping transitions, the press scale, and entrance motion.
- **Do** write interface copy in Spanish of Spain, in the band's own vocabulary (socios, convocatoria, junta, ensayo).
- **Do** treat sidebar and plaque tokens as the future per-band seam. They are not a theming API today.

### Don't:

- **Don't** set ochre, copper, manganese, or red as a second primary, and don't set ochre as small text on white.
- **Don't** put a status chip on the plaque. The plaque resets chips to white at 14%, and the enamel is lost.
- **Don't** add gradients, glass, staff lines, or clefs. The material is flat enamel.
- **Don't** put a drop shadow on a resting card, plaque, or page. Shadow is for floating layers and the selected segment.
- **Don't** introduce an 8px or 12px corner. The corners in use are 4, 6, and 10px, plus the full pill. `--radius` (0.5rem) and `--radius-xl` (12px) are declared and unused.
- **Don't** add 13px to the type scale. Small buttons already use it; the scale is 11, 12, 14, 15, 18, 20, 24, and 32px.
- **Don't** treat this palette as the official Solfeamos logo colors. Those values are not in the repo.
- **Don't** recolor the rail or the plaque per band until the template work exists. Inventing a tenant theme now skips the planned seam.
- **Don't** paint dark primary buttons with Nocturnal Cobalt Text. That hex is for text and links. Buttons use Nocturnal Button Cobalt and white.
- **Don't** lighten the dark meeting tile above `#2B7A57`: white labels on it hold about 5.2:1, and lighter greens drop below 4.5:1.
