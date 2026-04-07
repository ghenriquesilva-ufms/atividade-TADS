import process from "node:process";

const toInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
};

export function loadConfig() {
  return {
    port: toInt(process.env.PORT, 3000),
    externalApiUrl: process.env.EXTERNAL_API_URL ?? "http://localhost:4001",
    externalClientId: process.env.EXTERNAL_CLIENT_ID ?? "",
    externalClientIdParamName:
      process.env.EXTERNAL_CLIENT_ID_PARAM_NAME ?? "client_id",
    cacheTtlMs: toInt(process.env.CACHE_TTL_MS, 10000),
    staleCacheTtlMs: toInt(process.env.STALE_CACHE_TTL_MS, 60000),
    dispatchIntervalMs: toInt(process.env.DISPATCH_INTERVAL_MS, 1000),
    adaptiveMaxDispatchIntervalMs: toInt(
      process.env.ADAPTIVE_MAX_DISPATCH_INTERVAL_MS,
      3000
    ),
    adaptiveStepMs: toInt(process.env.ADAPTIVE_STEP_MS, 500),
    adaptiveCooldownMs: toInt(process.env.ADAPTIVE_COOLDOWN_MS, 8000),
    retrySuppressionWindowMs: toInt(
      process.env.RETRY_SUPPRESSION_WINDOW_MS,
      4000
    ),
    penaltySignalThresholdMs: toInt(
      process.env.PENALTY_SIGNAL_THRESHOLD_MS,
      2500
    ),
    requestTtlMs: toInt(process.env.REQUEST_TTL_MS, 60000),
    maxQueueSize: toInt(process.env.MAX_QUEUE_SIZE, 500),
    externalTimeoutMs: toInt(process.env.EXTERNAL_TIMEOUT_MS, 2000),
    retryMaxAttempts: toInt(process.env.RETRY_MAX_ATTEMPTS, 2),
    retryBaseDelayMs: toInt(process.env.RETRY_BASE_DELAY_MS, 300)
  };
}
