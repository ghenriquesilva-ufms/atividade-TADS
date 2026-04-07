import { loadConfig } from "./config/env.js";
import { CacheStore } from "./core/cacheStore.js";
import { MetricsTracker } from "./core/metrics.js";
import { createLogger } from "./utils/logger.js";
import { ExternalApiClient } from "./services/externalApiClient.js";
import { ProxyService } from "./services/proxyService.js";
import { createApp } from "./server.js";

const config = loadConfig();
const logger = createLogger();

if (!config.externalClientId) {
  throw new Error("EXTERNAL_CLIENT_ID nao configurado");
}

const cache = new CacheStore({
  ttlMs: config.cacheTtlMs,
  staleTtlMs: config.staleCacheTtlMs
});

const metrics = new MetricsTracker();
const externalApiClient = new ExternalApiClient({
  baseUrl: config.externalApiUrl,
  timeoutMs: config.externalTimeoutMs,
  clientId: config.externalClientId,
  clientIdParamName: config.externalClientIdParamName
});

const proxyService = new ProxyService({
  cache,
  externalApiClient,
  metrics,
  logger,
  dispatchIntervalMs: config.dispatchIntervalMs,
  adaptiveMaxDispatchIntervalMs: config.adaptiveMaxDispatchIntervalMs,
  adaptiveStepMs: config.adaptiveStepMs,
  adaptiveCooldownMs: config.adaptiveCooldownMs,
  retrySuppressionWindowMs: config.retrySuppressionWindowMs,
  penaltySignalThresholdMs: config.penaltySignalThresholdMs,
  requestTtlMs: config.requestTtlMs,
  maxQueueSize: config.maxQueueSize,
  retryMaxAttempts: config.retryMaxAttempts,
  retryBaseDelayMs: config.retryBaseDelayMs
});

proxyService.start();

const app = createApp({ proxyService, logger });
const server = app.listen(config.port, () => {
  logger.info({ port: config.port }, "proxy iniciado");
});

function shutdown(signal) {
  logger.info({ signal }, "encerrando servico");
  proxyService.stop();
  server.close(() => {
    process.exit(0);
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
