/** The role that runs Kira, as the server's own plugin spells it. */
export const ADMIN_ROLE = 'admin';

/**
 * Whether a role admits someone to the console.
 *
 * Better Auth's admin plugin accepts several roles comma-joined, so a plain
 * equality would read an administrator who also holds another role as an ordinary
 * user (docs/adr/0007). Written once so every screen reads the same field the same
 * way.
 */
export function isAdminRole(role: string | null | undefined): boolean {
  return (role ?? '').split(',').includes(ADMIN_ROLE);
}
