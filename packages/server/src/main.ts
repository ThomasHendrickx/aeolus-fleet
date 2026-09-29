import { createApp } from './app.js';
import { ConfigError, loadConfig } from './config.js';

async function start(): Promise<void> {
  const config = loadConfig(process.env);
  const server = createApp({
    databaseUrl: config.databaseUrl,
    publicUrl: config.publicUrl,
    logger: { level: config.logLevel },
    shouldTrustProxy: config.shouldTrustProxy,
    cookieDomain: config.cookieDomain,
    consoleOrigin: config.consoleOrigin,
  });

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      server.log.info({ signal }, 'shutting down');
      void server.close().then(() => process.exit(0));
    });
  }

  await server.listen({ host: config.host, port: config.port });
}

try {
  await start();
} catch (error) {
  console.error(error instanceof ConfigError ? error.message : error);
  process.exit(1);
}
