import { defineTheme } from '@astryxdesign/core/theme';
import { defineSyntaxTheme } from '@astryxdesign/core/theme/syntax';
import { neutralTheme } from '@astryxdesign/theme-neutral';

/**
 * Kira's theme, derived from Astryx's Neutral rather than editing it —
 * Neutral's generated palette is a reviewed artifact (see its own README),
 * and `extends` flattens inheritance so this stays a single self-contained
 * theme once built.
 *
 * `astryx theme build` compiles this into `built/kira.css` /
 * `built/kira.js` / `built/kira.d.ts`, which is what the app
 * actually imports (see `index.tsx`) — this file is the source theme
 * builds run against, not what ships.
 */

// Kira red. Dark mode uses the brand color as-is with dark text on it
// (#FFFFFF on #FF3859 is only 3.5:1); light mode deepens it so white text
// clears 4.5:1 and it still reads as the same red on paper.
const accent: [string, string] = ['#D4203F', '#FF3859'];

// Colors are authored per role rather than seeded through `color.accent`:
// the HCT seed bleeds the accent's hue into every neutral, which turned
// Kira's grays pink. These are warm, low-chroma ink (dark) and paper
// (light) neutrals with hover/press as translucent overlays, modeled on
// OpenChamber's default theme.
export const kiraTheme = defineTheme({
  name: 'kira',
  extends: neutralTheme,

  tokens: {
    // Surfaces. The shell's sidebar (body) sits one step off the working
    // canvas (surface); cards and popovers lift slightly from there.
    '--color-background-body': ['#F7F6F4', '#171615'],
    '--color-background-surface': ['#FDFCFA', '#120F0E'],
    '--color-background-card': ['#F8F7F5', '#181715'],
    '--color-background-popover': ['#FFFFFF', '#1E1C1A'],
    '--color-background-muted': ['#3939340A', '#FFFFFF08'],
    '--color-neutral': ['#39393414', '#C9C5BA1A'],
    '--color-overlay': ['#1A181566', '#00000099'],
    '--color-overlay-hover': ['#0000000D', '#FFFFFF12'],
    '--color-overlay-pressed': ['#00000014', '#FFFFFF1F'],

    // Text and icons.
    '--color-text-primary': ['#393A34', '#C9C5BA'],
    '--color-text-secondary': ['#5C5C54', '#8F8B81'],
    '--color-text-disabled': ['#A8A59F', '#5A5752'],
    '--color-text-accent': 'var(--color-accent)',
    '--color-icon-primary': ['#393A34', '#C9C5BA'],
    '--color-icon-secondary': ['#5C5C54', '#8F8B81'],
    '--color-icon-disabled': ['#A8A59F', '#5A5752'],
    '--color-icon-accent': 'var(--color-accent)',

    // Accent.
    '--color-accent': accent,
    '--color-accent-muted': ['#D4203F24', '#FF38592E'],
    '--color-on-accent': ['#FFFFFF', '#120F0E'],

    // Lines.
    '--color-border': ['#E5E1DE', '#242323'],
    '--color-border-emphasized': ['#CBC7C2', '#504E4C'],
    '--color-skeleton': ['#E5E1DE', '#242323'],
    '--color-track': ['#CBC7C2', '#3A3836'],
    '--color-shadow': ['#1A18151A', '#00000066'],

    // Elevation. Light mode keeps Neutral's shadows; dark mode halves their black,
    // because 25–70% black halos read as smudges on a near-black canvas. The 1px
    // white inset ring is what separates a raised surface in the dark, so a raised
    // surface needs no border of its own. Written whole rather than as a [light, dark]
    // pair: `light-dark()` takes colors, not shadow lists.
    '--shadow-low':
      '0 2px 4px light-dark(oklch(0 0 0 / 5%), oklch(0 0 0 / 12%)), 0 4px 8px light-dark(oklch(0 0 0 / 10%), oklch(0 0 0 / 18%)), inset 0 0 0 1px light-dark(transparent, oklch(1 0 0 / 7%))',
    '--shadow-med':
      '0 2px 4px light-dark(oklch(0 0 0 / 5%), oklch(0 0 0 / 18%)), 0 4px 12px light-dark(oklch(0 0 0 / 10%), oklch(0 0 0 / 28%)), inset 0 0 0 1px light-dark(transparent, oklch(1 0 0 / 9%))',
    '--shadow-high':
      '0 4px 6px light-dark(oklch(0 0 0 / 10%), oklch(0 0 0 / 30%)), 0 12px 24px light-dark(oklch(0 0 0 / 15%), oklch(0 0 0 / 45%)), inset 0 0 0 1px light-dark(transparent, oklch(1 0 0 / 11%))',

    // Status.
    '--color-success': ['#5F8D3D', '#76AD4F'],
    '--color-success-muted': ['#5F8D3D20', '#76AD4F20'],
    '--color-on-success': ['#FFFFFF', '#120F0E'],
    '--color-warning': ['#8D6C15', '#C67F13'],
    '--color-warning-muted': ['#8D6C1520', '#C67F1320'],
    '--color-on-warning': ['#FFFFFF', '#120F0E'],
    '--color-error': ['#B7493F', '#DA5B4A'],
    '--color-error-muted': ['#B7493F20', '#DA5B4A20'],
    '--color-on-error': ['#FFFFFF', '#120F0E'],
  },

  // Vitesse-derived code colors, matching OpenChamber's defaults. The dark
  // code background uses the card step instead of the canvas so code blocks
  // stay distinct inside the chat.
  syntax: defineSyntaxTheme({
    name: 'kira',
    tokens: {
      keyword: ['#15764E', '#34983A'],
      string: ['#C25F4B', '#D58373'],
      comment: ['#9DAE9D', '#728772'],
      number: ['#177B8F', '#279E93'],
      function: ['#4E8B18', '#78A952'],
      type: ['#0E8294', '#479CB1'],
      variable: ['#BB782A', '#C69457'],
      operator: ['#B94D50', '#DA6B6D'],
      constant: ['#177B8F', '#279E93'],
      tag: ['#15764E', '#34983A'],
      attribute: ['#BB782A', '#C69457'],
      property: ['#9A8402', '#BDA94A'],
      punctuation: ['#6B6B61', '#908B7E'],
      background: ['#F4F3F1', '#181715'],
    },
  }),

  // Same fonts and scale Kira already loads (Inter/Satoshi/Geist Mono,
  // base 14 / ratio 1.2, bold h3/h4 — matching Neutral's own scale),
  // declared through Astryx's typography config instead of a manual
  // --font-family-* override in CSS.
  typography: {
    scale: { base: 14, ratio: 1.2 },
    body: {
      family: 'Inter Variable',
      fallbacks: 'system-ui, sans-serif',
    },
    heading: {
      family: 'Satoshi Variable',
      fallbacks: '"Inter Variable", system-ui, sans-serif',
      weights: { 3: 'bold', 4: 'bold' },
    },
    code: {
      family: 'Geist Mono Variable',
      fallbacks: 'ui-monospace, monospace',
    },
  },

  // Keep corners subtle with half of Astryx's default radius scale: 2px
  // inner, 4px elements, 6px containers, and 14px page/chat surfaces.
  radius: { base: 4, multiplier: 0.5 },
});
