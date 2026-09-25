import { defineTheme } from '@astryxdesign/core/theme';
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
export const kiraTheme = defineTheme({
  name: 'kira',
  extends: neutralTheme,

  // Kira's brand accent. A single seed derives both light and dark
  // variants (and keeps --color-on-accent's contrast correct) rather than
  // hand-tuning --color-accent per mode.
  color: { accent: '#ff3859' },

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
