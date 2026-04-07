import { PriorityQueue } from "../core/priorityQueue.js";

const priorityMap = {
  high: 0,
  normal: 1,
  low: 2
};

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class ProxyService {
  constructor({
    cache,
    externalApiClient,
    metrics,
    logger,
    dispatchIntervalMs,
    adaptiveMaxDispatchIntervalMs,
    adaptiveStepMs,
    adaptiveCooldownMs,
    retrySuppressionWindowMs,
    penaltySignalThresholdMs,
    requestTtlMs,
    maxQueueSize,
    retryMaxAttempts,
    retryBaseDelayMs
  }) {
    this.cache = cache;
    this.externalApiClient = externalApiClient;
    this.metrics = metrics;
    this.logger = logger;

    this.dispatchIntervalMs = dispatchIntervalMs;
    this.currentDispatchIntervalMs = dispatchIntervalMs;
    this.adaptiveMaxDispatchIntervalMs = adaptiveMaxDispatchIntervalMs;
    this.adaptiveStepMs = adaptiveStepMs;
    this.adaptiveCooldownMs = adaptiveCooldownMs;
    this.retrySuppressionWindowMs = retrySuppressionWindowMs;
    this.penaltySignalThresholdMs = penaltySignalThresholdMs;
    this.requestTtlMs = requestTtlMs;
    this.maxQueueSize = maxQueueSize;
    this.retryMaxAttempts = retryMaxAttempts;
    this.retryBaseDelayMs = retryBaseDelayMs;

    this.queue = new PriorityQueue();
    this.queuedJobs = new Map();
    this.inflightJobs = new Map();
    this.processing = false;
    this.timer = null;
    this.lastDispatchAt = 0;
    this.adaptiveCooldownUntil = 0;
    this.retrySuppressedUntil = 0;
  }

  start() {
    if (this.timer) {
      return;
    }

    this.timer = setInterval(() => {
      this.#dispatch().catch((error) => {
        this.logger.error({ error }, "falha no scheduler");
      });
    }, 100);
  }

  stop() {
    if (!this.timer) {
      return;
    }

    clearInterval(this.timer);
    this.timer = null;
  }

  async requestScore(query, { priority = "normal", ttlMs } = {}) {
    this.metrics.incTotalRequests();

    const key = this.#buildCacheKey(query);
    const fresh = this.cache.getFresh(key);
    if (fresh) {
      this.metrics.incCacheHit();
      return {
        data: fresh,
        meta: {
          source: "cache"
        }
      };
    }

    const existingQueuedJob = this.queuedJobs.get(key);
    if (existingQueuedJob) {
      return this.#attachWaiter(existingQueuedJob);
    }

    const existingInflightJob = this.inflightJobs.get(key);
    if (existingInflightJob) {
      return this.#attachWaiter(existingInflightJob);
    }

    if (this.queue.size >= this.maxQueueSize) {
      this.metrics.incDrop("queue-overloaded");
      const stale = this.cache.getStale(key);
      if (stale) {
        return {
          data: stale,
          meta: {
            source: "stale-cache",
            reason: "queue-overloaded"
          }
        };
      }

      const overloadError = new Error("fila sobrecarregada");
      overloadError.statusCode = 503;
      throw overloadError;
    }

    const job = {
      key,
      query,
      createdAt: Date.now(),
      expiresAt: Date.now() + (ttlMs ?? this.requestTtlMs),
      priority: priorityMap[priority] ?? priorityMap.normal,
      waiters: []
    };

    const waiterPromise = this.#attachWaiter(job);
    this.queuedJobs.set(key, job);
    this.queue.push(job, job.priority);
    this.metrics.recordEnqueue(this.queue.size);

    this.logger.info(
      { key, queueSize: this.queue.size, priority: job.priority },
      "request enfileirada"
    );

    return waiterPromise;
  }

  getMetrics() {
    const now = Date.now();
    return this.metrics.snapshot(this.queue.size, {
      schedulerBaseIntervalMs: this.dispatchIntervalMs,
      schedulerCurrentIntervalMs: this.currentDispatchIntervalMs,
      adaptiveMode: now < this.adaptiveCooldownUntil,
      adaptiveCooldownRemainingMs: Math.max(this.adaptiveCooldownUntil - now, 0),
      retrySuppressed: now < this.retrySuppressedUntil,
      retrySuppressionRemainingMs: Math.max(this.retrySuppressedUntil - now, 0)
    });
  }

  getHealth() {
    return {
      status: "ok",
      schedulerRunning: Boolean(this.timer),
      processing: this.processing,
      queueSize: this.queue.size,
      adaptiveMode: Date.now() < this.adaptiveCooldownUntil
    };
  }

  #attachWaiter(job) {
    return new Promise((resolve, reject) => {
      job.waiters.push({
        resolve,
        reject,
        startedAt: Date.now()
      });
    });
  }

  async #dispatch() {
    if (this.processing) {
      return;
    }

    const now = Date.now();
    if (
      this.lastDispatchAt !== 0 &&
      now - this.lastDispatchAt < this.currentDispatchIntervalMs
    ) {
      return;
    }

    const job = this.#nextValidJob();
    if (!job) {
      return;
    }

    this.processing = true;
    this.lastDispatchAt = Date.now();
    this.queuedJobs.delete(job.key);
    this.inflightJobs.set(job.key, job);

    try {
      const data = await this.#callExternalWithRetry(job);
      this.cache.set(job.key, data);
      this.#relaxCadenceIfNeeded();
      this.#resolveJob(job, {
        data,
        meta: {
          source: "external"
        }
      });
    } catch (error) {
      const stale = this.cache.getStale(job.key);
      if (stale) {
        this.#resolveJob(job, {
          data: stale,
          meta: {
            source: "stale-cache",
            reason: "external-failure"
          }
        });
      } else {
        this.#rejectJob(job, error);
      }

      this.#tightenCadence("external-failure");
    } finally {
      this.inflightJobs.delete(job.key);
      this.processing = false;
    }
  }

  #nextValidJob() {
    while (this.queue.size > 0) {
      const job = this.queue.pop();
      if (!job) {
        return null;
      }

      if (job.expiresAt < Date.now()) {
        this.queuedJobs.delete(job.key);
        const ttlError = new Error("request expirada na fila");
        ttlError.statusCode = 504;
        this.metrics.incDrop("ttl-expired");
        this.#rejectJob(job, ttlError);
        this.logger.warn({ key: job.key }, "request descartada por ttl");
        continue;
      }

      return job;
    }

    return null;
  }

  async #callExternalWithRetry(job) {
    let attempt = 0;
    let lastError;

    while (attempt <= this.retryMaxAttempts) {
      const startedAt = Date.now();

      try {
        const data = await this.externalApiClient.fetchScore(job.query);
        const elapsedMs = Date.now() - startedAt;

        if (elapsedMs >= this.penaltySignalThresholdMs) {
          this.#tightenCadence("penalty-signal");
        }

        return data;
      } catch (error) {
        lastError = error;
        const statusCode = error.response?.status;
        const retriable = !statusCode || statusCode >= 500;

        if (!retriable || attempt === this.retryMaxAttempts) {
          break;
        }

        if (Date.now() < this.retrySuppressedUntil) {
          this.logger.warn(
            {
              key: job.key,
              suppressedForMs: this.retrySuppressedUntil - Date.now()
            },
            "retry suprimido por janela de protecao"
          );
          break;
        }

        this.metrics.incRetry();
        const backoff = this.retryBaseDelayMs * Math.pow(2, attempt);
        this.logger.warn(
          { key: job.key, attempt, backoff },
          "falha no externo, aplicando retry"
        );
        await wait(backoff);
      }

      attempt += 1;
    }

    const serviceError = new Error("falha ao consultar api externa");
    serviceError.statusCode = 502;
    serviceError.cause = lastError;
    throw serviceError;
  }

  #tightenCadence(reason) {
    this.currentDispatchIntervalMs = Math.min(
      this.currentDispatchIntervalMs + this.adaptiveStepMs,
      this.adaptiveMaxDispatchIntervalMs
    );
    this.adaptiveCooldownUntil = Date.now() + this.adaptiveCooldownMs;
    this.retrySuppressedUntil = Date.now() + this.retrySuppressionWindowMs;

    this.logger.warn(
      {
        reason,
        currentDispatchIntervalMs: this.currentDispatchIntervalMs,
        adaptiveCooldownUntil: this.adaptiveCooldownUntil,
        retrySuppressedUntil: this.retrySuppressedUntil
      },
      "cadencia adaptativa ativada"
    );
  }

  #relaxCadenceIfNeeded() {
    const now = Date.now();
    if (now < this.adaptiveCooldownUntil) {
      return;
    }

    if (this.currentDispatchIntervalMs === this.dispatchIntervalMs) {
      return;
    }

    this.currentDispatchIntervalMs = Math.max(
      this.dispatchIntervalMs,
      this.currentDispatchIntervalMs - this.adaptiveStepMs
    );
  }

  #resolveJob(job, payload) {
    for (const waiter of job.waiters) {
      const latency = Date.now() - waiter.startedAt;
      this.metrics.recordProcessed(latency);
      waiter.resolve(payload);
    }
  }

  #rejectJob(job, error) {
    for (const waiter of job.waiters) {
      const latency = Date.now() - waiter.startedAt;
      this.metrics.recordProcessed(latency);
      this.metrics.incError();
      waiter.reject(error);
    }
  }

  #buildCacheKey(query) {
    const params = new URLSearchParams();
    const sortedKeys = Object.keys(query).sort();

    for (const key of sortedKeys) {
      params.append(key, query[key]);
    }

    return params.toString();
  }
}
