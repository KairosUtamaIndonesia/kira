/** A live run is short enough to read beside a chat title. */
export function formatRunDuration(milliseconds: number): string {
  const seconds = Math.floor(Math.max(0, milliseconds) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/**
 * How long a step or a turn took, as it reads beside it: milliseconds while that
 * is still the useful unit, then seconds, and minutes once there are enough of
 * them. Kept apart from {@link formatRunDuration} because a finished step can be
 * shorter than a second, where a rail's ticking clock never is.
 */
export function formatDuration(milliseconds: number): string {
  if (milliseconds < 1000) {
    return `${milliseconds}ms`;
  }

  const seconds = milliseconds / 1000;

  if (seconds < 60) {
    return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)}s`;
  }

  const minutes = Math.floor(seconds / 60);

  return `${minutes}m ${Math.round(seconds - minutes * 60)}s`;
}
