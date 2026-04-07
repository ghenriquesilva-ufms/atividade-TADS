import axios from "axios";
import pino from "pino";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CacheStore } from "../src/core/cacheStore.js";
import { MetricsTracker } from "../src/core/metrics.js";
import { ExternalApiClient } from "../src/services/externalApiClient.js";
import { ProxyService } from "../src/services/proxyService.js";
import { createApp } from "../src/server.js";
import { startMockExternalApi } from "./helpers/mockExternalApi.js";

const logger = pino({ enabled: false });

describe("Proxy de rate limit", () => {
  let mock;
  let proxyService;
  let app;
  let externalControl;

  beforeEach(async () => {
    mock = await startMockExternalApi();
    externalControl = axios.create({ baseURL: mock.url, timeout: 10000 });

    const cache = new CacheStore({ ttlMs: 5000, staleTtlMs: 20000 });
    const metrics = new MetricsTracker();
    const externalApiClient = new ExternalApiClient({
      baseUrl: mock.url,
      timeoutMs: 1500,
      clientId: "cliente-teste-123",
      clientIdParamName: "client_id"
    });

    proxyService = new ProxyService({
      cache,
      externalApiClient,
      metrics,
      logger,
      dispatchIntervalMs: 1000,
      adaptiveMaxDispatchIntervalMs: 3000,
      adaptiveStepMs: 500,
      adaptiveCooldownMs: 5000,
      retrySuppressionWindowMs: 2500,
      penaltySignalThresholdMs: 2500,
      requestTtlMs: 60000,
      maxQueueSize: 1000,
      retryMaxAttempts: 1,
      retryBaseDelayMs: 150
    });

    proxyService.start();
    app = createApp({ proxyService, logger });
  });

  afterEach(async () => {
    proxyService.stop();
    await mock.stop();
  });

  it(
    "cenario de burst: 20 requests em 1 segundo sem penalidade",
    async () => {
      const calls = Array.from({ length: 20 }, (_, idx) =>
        request(app).get("/proxy/score").query({ id: String(idx + 1) })
      );

      const responses = await Promise.all(calls);
      for (const response of responses) {
        expect(response.status).toBe(200);
        expect(response.body.ok).toBe(true);
      }

      const stats = (await externalControl.get("/__stats")).data;
      expect(stats.totalRequests).toBe(20);
      expect(stats.penaltyCount).toBe(0);

      const timestamps = stats.requestTimestamps;
      for (let i = 1; i < timestamps.length; i += 1) {
        const diff = timestamps[i] - timestamps[i - 1];
        expect(diff).toBeGreaterThanOrEqual(900);
      }
    },
    60000
  );

  it("cenario de penalidade: abuso direto gera penalidade e proxy evita", async () => {
    await externalControl.get("/score", { params: { direct: "1" } });

    const startedAt = Date.now();
    await externalControl.get("/score", { params: { direct: "2" } });
    const elapsedMs = Date.now() - startedAt;

    await externalControl.get("/score", { params: { direct: "3" } });

    const directStats = (await externalControl.get("/__stats")).data;
    expect(directStats.penaltyCount).toBeGreaterThan(0);
    expect(elapsedMs).toBeGreaterThanOrEqual(1800);

    await externalControl.post("/__reset");

    const calls = Array.from({ length: 5 }, (_, idx) =>
      request(app).get("/proxy/score").query({ burst: String(idx + 1) })
    );
    await Promise.all(calls);

    const proxyStats = (await externalControl.get("/__stats")).data;
    expect(proxyStats.penaltyCount).toBe(0);
  }, 30000);

  it("cenario de api lenta: cache protege e retries sao limitados", async () => {
    const warmup = await request(app)
      .get("/proxy/score")
      .query({ key: "cacheavel" });
    expect(warmup.status).toBe(200);
    expect(warmup.body.source).toBe("external");

    const statsBefore = (await externalControl.get("/__stats")).data;

    await externalControl.post("/__control", { baseDelayMs: 3500 });

    const startedAt = Date.now();
    const cached = await request(app)
      .get("/proxy/score")
      .query({ key: "cacheavel" });
    const elapsedMs = Date.now() - startedAt;

    expect(cached.status).toBe(200);
    expect(cached.body.source).toBe("cache");
    expect(elapsedMs).toBeLessThan(500);

    const statsAfterCache = (await externalControl.get("/__stats")).data;
    expect(statsAfterCache.totalRequests).toBe(statsBefore.totalRequests);

    const failed = await request(app).get("/proxy/score").query({ key: "novo" });
    expect(failed.status).toBe(502);

    const statsAfterFailure = (await externalControl.get("/__stats")).data;
    expect(statsAfterFailure.totalRequests - statsAfterCache.totalRequests).toBe(2);
  }, 30000);

  it("cenario de politica de fila: prioridade e ttl", async () => {
    const lowPromise = request(app)
      .get("/proxy/score")
      .set("x-priority", "low")
      .set("x-ttl-ms", "500")
      .query({ item: "low" });

    const highPromise = request(app)
      .get("/proxy/score")
      .set("x-priority", "high")
      .query({ item: "high" });

    const [lowResponse, highResponse] = await Promise.all([lowPromise, highPromise]);

    expect(highResponse.status).toBe(200);
    expect(lowResponse.status).toBe(504);
  }, 15000);

  it("cenario adaptativo: falha ativa janela de protecao e aumenta cadencia", async () => {
    await externalControl.post("/__control", {
      forceError: true,
      errorStatus: 503
    });

    const failed = await request(app).get("/proxy/score").query({ adaptive: "1" });
    expect(failed.status).toBe(502);

    const metricsResponse = await request(app).get("/metrics");
    expect(metricsResponse.status).toBe(200);
    expect(metricsResponse.body.adaptiveMode).toBe(true);
    expect(metricsResponse.body.schedulerCurrentIntervalMs).toBeGreaterThan(1000);
    expect(metricsResponse.body.retrySuppressed).toBe(true);
  }, 20000);

  it("cenario de observabilidade: endpoint de metricas expone percentis e fila", async () => {
    await request(app).get("/proxy/score").query({ m: "1" });
    await request(app).get("/proxy/score").query({ m: "2" });
    await request(app).get("/proxy/score").query({ m: "3" });

    const metricsResponse = await request(app).get("/metrics");
    expect(metricsResponse.status).toBe(200);

    const metricsPayload = metricsResponse.body;
    expect(metricsPayload.totalRequests).toBeGreaterThanOrEqual(3);
    expect(metricsPayload.totalEnqueued).toBeGreaterThanOrEqual(3);
    expect(metricsPayload.maxQueueSizeObserved).toBeGreaterThanOrEqual(1);
    expect(metricsPayload.enqueueRatePerSecond).toBeGreaterThan(0);
    expect(metricsPayload.latencyP50Ms).toBeGreaterThan(0);
    expect(metricsPayload.latencyP95Ms).toBeGreaterThan(0);
    expect(metricsPayload.latencyP99Ms).toBeGreaterThan(0);
    expect(typeof metricsPayload.dropsByReason).toBe("object");
    expect(metricsPayload.schedulerBaseIntervalMs).toBe(1000);
    expect(metricsPayload.schedulerCurrentIntervalMs).toBeGreaterThanOrEqual(1000);
  }, 20000);

  it("cenario de client id: proxy injeta credencial sem expor para cliente interno", async () => {
    const response = await request(app)
      .get("/proxy/score")
      .query({ userId: "abc", client_id: "nao-deve-passar" });

    expect(response.status).toBe(200);

    const stats = (await externalControl.get("/__stats")).data;
    expect(stats.lastRequestQuery.userId).toBe("abc");
    expect(stats.lastRequestQuery.client_id).toBe("cliente-teste-123");
  }, 20000);
});
