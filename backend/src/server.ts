import { createApp } from './app';
import { env } from './config/env';
import { closePool, verifyConnection } from './config/database';
import { runMigrations } from './database/migrate';
import { checkInvariants } from './services/invariant.service';
import { RequestService } from './services/request.service';
import { logger } from './utils/logger';

async function main() {
  await verifyConnection();
  await runMigrations();

  const report = await checkInvariants();
  if (!report.healthy) {
    logger.error('Refusing to start: system invariant violated', undefined, report);
    process.exit(1);
  }

  // Best-effort periodic expiry of stale money requests.
  await RequestService.expireStale().catch((e) => logger.error('expiry sweep failed', e));
  const sweep = setInterval(
    () => void RequestService.expireStale().catch((e) => logger.error('expiry sweep failed', e)),
    60_000
  );
  sweep.unref();

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    logger.info(`Artho API listening on :${env.PORT}`, { env: env.NODE_ENV });
  });

  const shutdown = (signal: string) => {
    logger.info(`received ${signal}, shutting down`);
    server.close(async () => {
      await closePool();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.error('fatal startup error', err);
  process.exit(1);
});
