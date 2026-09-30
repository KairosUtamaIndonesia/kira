import type { Config } from './config';
import type { Database } from './database';
import { poolCatalog } from './pool';

/** Dependencies whose failure should keep Kira out of service, without changing liveness. */
export async function readiness(database: Database, config: Config): Promise<boolean> {
  let databaseTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      database.$client.query('SELECT 1'),
      new Promise<never>((_, reject) => {
        databaseTimer = setTimeout(
          () => reject(new Error('Database readiness check timed out.')),
          2_000,
        );
      }),
    ]);
  } catch {
    return false;
  } finally {
    if (databaseTimer !== undefined) clearTimeout(databaseTimer);
  }

  let processIsAlive: boolean;
  try {
    const response = await fetch(`${config.pool.url}/healthz`, {
      signal: AbortSignal.timeout(2_000),
    });
    processIsAlive = response.ok;
    await response.body?.cancel();
  } catch {
    processIsAlive = false;
  }

  if (!processIsAlive) return false;

  const catalog = await poolCatalog(config, { fresh: true });
  return catalog.kind === 'ok' && catalog.models.length > 0;
}
