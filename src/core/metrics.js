export class MetricsTracker {
  constructor() {
    this.startedAt = Date.now();
    this.totalRequests = 0;
    this.totalEnqueued = 0;
    this.totalErrors = 0;
    this.totalProcessed = 0;
    this.totalLatencyMs = 0;
    this.latencySamples = [];
    this.maxLatencySamples = 5000;
    this.cacheHits = 0;
    this.queueDrops = 0;
    this.dropsByReason = {};
    this.maxQueueSizeObserved = 0;
    this.retryCount = 0;
  }

  incTotalRequests() {
    this.totalRequests += 1;
  }

  incError() {
    this.totalErrors += 1;
  }

  incCacheHit() {
    this.cacheHits += 1;
  }

  incDrop(reason = "unknown") {
    this.queueDrops += 1;
    this.dropsByReason[reason] = (this.dropsByReason[reason] ?? 0) + 1;
  }

  incRetry() {
    this.retryCount += 1;
  }

  recordEnqueue(queueSize) {
    this.totalEnqueued += 1;
    this.recordQueueSize(queueSize);
  }

  recordQueueSize(queueSize) {
    if (queueSize > this.maxQueueSizeObserved) {
      this.maxQueueSizeObserved = queueSize;
    }
  }

  recordProcessed(latencyMs) {
    this.totalProcessed += 1;
    this.totalLatencyMs += latencyMs;
    this.latencySamples.push(latencyMs);

    if (this.latencySamples.length > this.maxLatencySamples) {
      this.latencySamples.shift();
    }
  }

  snapshot(queueSize, extra = {}) {
    this.recordQueueSize(queueSize);

    const avgLatency =
      this.totalProcessed === 0 ? 0 : this.totalLatencyMs / this.totalProcessed;
    const uptimeSeconds = Math.max(
      (Date.now() - this.startedAt) / 1000,
      1
    );
    const enqueueRatePerSecond = this.totalEnqueued / uptimeSeconds;

    const percentiles = this.#getLatencyPercentiles();

    return {
      totalRequests: this.totalRequests,
      totalEnqueued: this.totalEnqueued,
      queueSize,
      maxQueueSizeObserved: this.maxQueueSizeObserved,
      enqueueRatePerSecond: Number(enqueueRatePerSecond.toFixed(3)),
      averageLatencyMs: Number(avgLatency.toFixed(2)),
      latencyP50Ms: percentiles.p50,
      latencyP95Ms: percentiles.p95,
      latencyP99Ms: percentiles.p99,
      errorRate:
        this.totalRequests === 0
          ? 0
          : Number((this.totalErrors / this.totalRequests).toFixed(4)),
      cacheHits: this.cacheHits,
      droppedRequests: this.queueDrops,
      dropsByReason: this.dropsByReason,
      retries: this.retryCount,
      uptimeSeconds: Number(uptimeSeconds.toFixed(2)),
      ...extra
    };
  }

  #getLatencyPercentiles() {
    if (this.latencySamples.length === 0) {
      return { p50: 0, p95: 0, p99: 0 };
    }

    const sorted = [...this.latencySamples].sort((a, b) => a - b);
    return {
      p50: this.#percentile(sorted, 0.5),
      p95: this.#percentile(sorted, 0.95),
      p99: this.#percentile(sorted, 0.99)
    };
  }

  #percentile(sortedValues, percentile) {
    const index = Math.min(
      sortedValues.length - 1,
      Math.floor(percentile * sortedValues.length)
    );
    return Number(sortedValues[index].toFixed(2));
  }
}
