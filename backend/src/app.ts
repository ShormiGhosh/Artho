import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/env';
import { requestContext } from './middleware/requestContext';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import api from './routes';

export function createApp() {
  const app = express();

  app.set('trust proxy', 1);
  // Safety net: never throw when a stray BigInt reaches JSON serialization.
  app.set('json replacer', (_key: string, value: unknown) =>
    typeof value === 'bigint' ? value.toString() : value
  );

  app.use(helmet()); 
  app.use(
    cors({
      origin: env.CORS_ORIGIN === '*' ? true : env.CORS_ORIGIN.split(','),
      credentials: true,
    })
  );
  app.use(express.json({ limit: '256kb' }));
  app.use(requestContext);

  app.get('/', (_req, res) => {
    res.json({ name: 'Artho API', version: '1.0.0', docs: '/api/health' });
  });

  app.use('/api', api);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
