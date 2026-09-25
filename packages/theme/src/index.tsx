import { Theme } from '@astryxdesign/core/theme';
import type { ReactNode } from 'react';
import { foundryTheme } from './built/foundry';
import './theme.css';

/**
 * Foundry's theme, applied once so every surface is themed the same way.
 *
 * The CSS comes with this import rather than being asked for separately: a
 * consumer that took the provider without the rules would draw Foundry's
 * components in Astryx's default type, and nothing would say so. What is left for
 * a consumer is its own layout, which is structure rather than looks.
 *
 * Astryx's components are styled by call site, so this shares the palette and the
 * typefaces and not the arrangement. Two surfaces reading as one product also
 * needs them built from the same components.
 */
export function FoundryTheme({ children }: { children: ReactNode }) {
  return <Theme theme={foundryTheme}>{children}</Theme>;
}
