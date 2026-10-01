import * as stylex from '@stylexjs/stylex';

/**
 * Marks a rail row or a section head, so what is inside it can answer to the
 * pointer over it. Our own marker rather than StyleX's default one: Astryx marks
 * its components with the default, and a hover over any of them would reveal every
 * row's tools at once.
 */
export const railMarker = stylex.defineMarker();
