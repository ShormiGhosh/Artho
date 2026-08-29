import { createApp } from './app';
import { env } from './config/env';
import { closePool, verifyConnection } from './config/database';
import { runMigrations } from './database/migrate';
import { checkInvariants } from './services/invariant.service';
import { RequestService } from './services/request.service';
import { StipendService } from './services/stipend.service';
import { DebtService } from './services/debt.service';
import { logger } from './utils/logger';

async function main() {
  await verifyConnection();
  await runMigrations();

  const report = await checkInvariants();
  if (!report.healthy) {
    logger.error('Refusing to start: system invariant violated', undefined, report);
    process.exit(1);
  }

  // Finish any disbursement interrupted by a crash, then keep sweeping for
  // stalled batches and expiring stale money requests.
  await StipendService.resumeStuckDisbursements().catch((e) =>
    logger.error('disbursement resume failed', e)
  );
  await DebtService.resumeStuckSettlements().catch((e) =>
    logger.error('settlement resume failed', e)
  );
  await RequestService.expireStale().catch((e) => logger.error('expiry sweep failed', e));
  const sweep = setInterval(() => {
    void RequestService.expireStale().catch((e) => logger.error('expiry sweep failed', e));
    void StipendService.resumeStuckDisbursements().catch((e) =>
      logger.error('disbursement resume failed', e)
    );
    void DebtService.resumeStuckSettlements().catch((e) =>
      logger.error('settlement resume failed', e)
    );
  }, 60_000);
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
