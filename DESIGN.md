---
name: Conestee Crit Series
description: A light, high-contrast race-series app built to be read outdoors in direct sun.
colors:
  series-blue: "#0b4fa8"
  on-series-blue: "#ffffff"
  signal-amber: "#f59e0b"
  stop-red: "#b42318"
  go-green: "#067647"
  caution-yellow: "#f5b700"
  ink-navy: "#0f172a"
  paper-white: "#ffffff"
  slate-note: "#475569"
  mist: "#eef2f6"
  rule-line: "#cbd5e1"
  field-edge: "#64748b"
typography:
  display:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "1.875rem"
    fontWeight: 700
    lineHeight: 1.2
  headline:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 700
    lineHeight: 1.33
  title:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 700
    lineHeight: 1.56
  body:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 600
    lineHeight: 1.43
rounded:
  sm: "4px"
  md: "6px"
  lg: "8px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.series-blue}"
    textColor: "{colors.on-series-blue}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "0 16px"
    height: "44px"
  button-primary-large:
    backgroundColor: "{colors.series-blue}"
    textColor: "{colors.on-series-blue}"
    rounded: "{rounded.md}"
    padding: "0 24px"
    height: "56px"
  button-secondary:
    backgroundColor: "{colors.paper-white}"
    textColor: "{colors.ink-navy}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "0 16px"
    height: "44px"
  button-secondary-hover:
    backgroundColor: "{colors.mist}"
  button-destructive:
    backgroundColor: "{colors.stop-red}"
    textColor: "{colors.paper-white}"
    rounded: "{rounded.md}"
    padding: "0 16px"
    height: "44px"
  input:
    backgroundColor: "{colors.paper-white}"
    textColor: "{colors.ink-navy}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "44px"
  card:
    backgroundColor: "{colors.paper-white}"
    textColor: "{colors.ink-navy}"
    rounded: "{rounded.lg}"
    padding: "16px"
  badge-neutral:
    backgroundColor: "{colors.mist}"
    textColor: "{colors.ink-navy}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "2px 8px"
  badge-success:
    backgroundColor: "{colors.go-green}"
    textColor: "{colors.paper-white}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "2px 8px"
  badge-warning:
    backgroundColor: "{colors.caution-yellow}"
    textColor: "#000000"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "2px 8px"
  badge-danger:
    backgroundColor: "{colors.stop-red}"
    textColor: "{colors.paper-white}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "2px 8px"
  header:
    backgroundColor: "{colors.series-blue}"
    textColor: "{colors.on-series-blue}"
---

# Design System: Conestee Crit Series

## Overview

**Creative North Star: "The Race-Day Clipboard"**

The app is a tool held in one hand at an outdoor desk, in direct sun, sometimes with gloves on. It reads like a well-kept clipboard: one sheet of white paper, dark ink, a blue header strip, and a few colored stamps that mean exactly one thing each. Nothing on the page is there for atmosphere. Every visual choice serves reading at a glance and tapping without missing.

Density is moderate and single-column. Pages sit in a narrow centered column on every screen size, so a phone, a tablet at the desk, and a laptop at home all show the same sheet. Depth comes from 2px borders and tinted fills, never from shadows. The type is the device's own system font, which keeps the first render fast on weak connections at the park (D-007).

The system rejects dark mode, decorative gradients, drop shadows, and web fonts. The single light theme is deliberate, because a dark screen washes out in sunlight.

**Key Characteristics:**
- One light theme, with text at 4.5:1 or better and input borders at 3:1.
- A blue header band, white page, and dark navy ink.
- Status shown with solid color badges: green for done, red for a problem, yellow for check this, gray for neutral.
- 2px borders everywhere a surface needs an edge.
- Tap targets 44px or taller, and 56px for the main actions.
- System fonts and bold weights instead of display faces.

## Colors

The palette is a sheet of white paper with navy ink, one blue for identity and action, and three signal colors that each keep one meaning.

### Primary
- **Series Blue** (`series-blue`): The header band, primary buttons, links, the browser theme color, and text selection. It's the only color used for identity, and it always carries white text.

### Secondary
- **Signal Amber** (`signal-amber`): The focus ring only. It is bright enough to see against blue, white, and gray in sunlight, which is why focus doesn't use Series Blue.

### Tertiary
- **Go Green** (`go-green`): Done and good states, such as "Paid," "Waiver," "Checked in," "Confirmed," and "Race day," plus success alerts and the setup checklist's done icon.
- **Stop Red** (`stop-red`): Problems and destructive actions, such as "No waiver," errors, urgent announcements, canceled events, and delete buttons.
- **Caution Yellow** (`caution-yellow`): Check-this warnings, such as eligibility notes. It always carries black text, never white.

### Neutral
- **Ink Navy** (`ink-navy`): All body text and headings, and the border on secondary buttons.
- **Paper White** (`paper-white`): The page and every card background.
- **Slate Note** (`slate-note`): Hints, timestamps, footers, and other secondary text. It still meets 4.5:1 on white.
- **Mist** (`mist`): Neutral badges, button hover fills, and muted panels.
- **Rule Line** (`rule-line`): Card and divider borders.
- **Field Edge** (`field-edge`): Input borders, darker than Rule Line so form fields meet 3:1.

### Named Rules
**The One Meaning Rule.** Green means done, red means a problem, and yellow means check this. Never use a signal color for decoration or brand.

**The Sunlight Rule.** Every text color passes 4.5:1 on the background it sits on, and every field border passes 3:1. Check contrast before adding any new color.

**The Tint Rule.** Alerts use their signal color at 10% opacity as the fill, with a full 2px border in the full-strength color. Text on a tint stays Ink Navy.

## Typography

**Display Font:** The device's system sans-serif (`ui-sans-serif`, `system-ui`, then Segoe UI, Roboto, sans-serif).
**Body Font:** The same stack.

**Character:** One familiar face at a few clear sizes. Hierarchy comes from size steps and bold weight, not from a second family.

### Hierarchy
- **Display** (`display`): Page titles (h1), one per page.
- **Headline** (`headline`): Section headings (h2), and stat values on the admin dashboard.
- **Title** (`title`): Card and list item headings (h3), such as an announcement title or a category name.
- **Body** (`body`): Running text, buttons, inputs, and nav links. Body text is never smaller than 16px, which also stops iOS from zooming into fields.
- **Label** (`label`): Badges, hints, timestamps, field help, and table text on phones.

### Named Rules
**The Bold Hierarchy Rule.** Headings are bold (700) and buttons and labels are semibold (600). Don't add light or thin weights.

**The Tabular Numbers Rule.** Tables use tabular numerals, so places, points, bibs, and times line up in columns.

**The No Eyebrow Rule.** Don't put a small uppercase label above a heading. Put the words in the heading itself, as in "Next race: Race 4." The one uppercase small label in use is the home page sponsor strip heading, which is its own section heading.

## Layout

Every page is one centered column, 48rem (768px) wide at most, with a 16px side gutter. The header, main area, and footer share that column. The main area is at least one screen tall, so content that streams in doesn't push the footer around (D-123).

Sections stack with 24px between them, and items inside a section use 8-12px gaps. Cards use 16px padding, and dashboard and weather tiles use 12px. The layout is mobile-first: a few groups go from one or two columns on phones to rows or three columns at the 640px breakpoint. Examples are the home page's next-race buttons, the weather tiles, and the admin stat grid.

Headings and body text wrap with `text-wrap: balance` and `pretty`. Wide tables scroll inside their own container, never the page.

### Named Rules
**The One Column Rule.** No sidebars or multi-column page layouts. The narrow column reads the same on a phone at the desk and a laptop at home.

## Elevation & Depth

The system is flat. No element casts a shadow. Depth and grouping come from 2px borders in Rule Line, tinted fills for alerts, and the solid blue header band. Interactive states change fill or underline, never elevation.

### Named Rules
**The Flat Sheet Rule.** Don't add box shadows. To separate a surface, give it a 2px border or a tinted fill.

## Shapes

Corners are gently rounded and stay small, so surfaces read as paper, not as pills. Badges use 4px corners (`rounded.sm`), buttons and inputs use 6px (`rounded.md`), and cards, tiles, and alerts use 8px (`rounded.lg`). Borders are 2px on cards, buttons, inputs, and alerts. Dividers and table rules can be 1px.

### Named Rules
**The Full Border Rule.** Edges go all the way around. Don't use a thick colored stripe on one side of a card or alert.

## Components

### Buttons
Solid, wide, and easy to hit, sized for thumbs and gloves.
- **Shape:** Gently rounded (6px), 44px tall at default and small sizes, and 56px tall with 18px text at the large size.
- **Primary:** Series Blue fill with white semibold text. Hover dims the fill to 90%.
- **Secondary:** White fill, a 2px Ink Navy border, and Ink Navy text. Hover fills with Mist.
- **Ghost:** No fill or border. Hover fills with Mist.
- **Destructive:** Stop Red fill with white text.
- **Link:** Series Blue underlined text with no minimum height, for inline actions.
- **Focus:** A 4px Signal Amber ring.
- **Disabled:** 60% opacity, not clickable.

### Chips
Status badges are the only chips.
- **Style:** Small semibold label text in a 4px-cornered block, with 2px by 8px padding.
- **Tones:** Neutral (Mist with Ink Navy), success (Go Green with white), warning (Caution Yellow with black), and danger (Stop Red with white). Badges show state and aren't interactive.

### Cards / Containers
- **Corner Style:** 8px.
- **Background:** Paper White.
- **Shadow Strategy:** None (see Elevation & Depth).
- **Border:** 2px Rule Line.
- **Internal Padding:** 16px for cards and 12px for stat and weather tiles.
- **Alerts:** The same 8px or 6px corners with a full 2px border in the signal color over a 10% tint of it. Errors are announced as alerts and other tones as status messages.

### Inputs / Fields
- **Style:** White fill, a 2px Field Edge border, 6px corners, 44px tall, and 16px text.
- **Focus:** A 4px Signal Amber ring.
- **Error:** The border turns Stop Red, and a semibold Stop Red message sits under the field, connected for screen readers.
- **Labels:** Semibold 16px labels sit above each field, with an optional Slate Note hint between the label and the field.

### Navigation
- **Header:** A solid Series Blue band with the series name in bold 18px white text, and semibold white nav links that underline on hover. Each link is at least 44px tall, and the links wrap onto a second line on narrow phones.
- **Footer:** Underlined Slate Note links at label size, followed by the note "Times shown in Eastern Time."
- **Admin:** A wrapped row of underlined Series Blue links above a divider.
- **Skip link:** A "Skip to main content" link appears on first focus.

### Check-in roster
The signature component, built for the desk. It's a long list of riders, each with their name, category, and team, and a row of status badges such as "Paid," "Waiver," and "No waiver." Above the list are large "Scan a code" and "Walk-up" buttons, a table of counts per category, a search field for a name or bib, and category filter buttons. Everything stays usable offline, and banners above the list report the sync state.

## Do's and Don'ts

### Do:
- **Do** keep every tap target at least 44px tall, and use the 56px large button for the main action on a screen.
- **Do** use Series Blue for one primary action per group, and secondary buttons for the rest.
- **Do** separate surfaces with 2px Rule Line borders and 8px corners.
- **Do** show state with the four badge tones, using the words riders and staff use, such as "Paid," "Waiver," and "Checked in."
- **Do** stack the action buttons full width on phones, rather than squeezing labels into a grid.
- **Do** use drawn icons from Lucide (lucide-react), hidden from screen readers when the text already says the same thing.

### Don't:
- **Don't** add a dark theme, drop shadows, gradients, or web fonts (D-007).
- **Don't** use a thick colored stripe on one side of a card or alert.
- **Don't** put white text on Caution Yellow.
- **Don't** use Unicode characters such as ✓ or ! as icons.
- **Don't** use body text smaller than 16px or secondary text lighter than Slate Note.
- **Don't** put a small uppercase eyebrow label above a heading.
