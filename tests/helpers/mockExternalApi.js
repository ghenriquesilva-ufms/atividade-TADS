import express from "express";

export async function startMockExternalApi() {
  const app = express();
  app.use(express.json());

  const state = {
    totalRequests: 0,
    penaltyCount: 0,
    pendingPenaltyMs: 0,
    lastRequestAt: 0,
    requestTimestamps: [],
    lastRequestQuery: null,
    baseDelayMs: 0,
    forceError: false,
    errorStatus: 500
  };

  app.get("/score", async (req, res) => {
    const now = Date.now();
    if (state.lastRequestAt !== 0 && now - state.lastRequestAt < 1000) {
      state.pendingPenaltyMs += 2000;
      state.penaltyCount += 1;
    }

    state.lastRequestAt = now;
    state.totalRequests += 1;
    state.requestTimestamps.push(now);
    state.lastRequestQuery = req.query;

    const responseDelay = state.baseDelayMs + state.pendingPenaltyMs;
    state.pendingPenaltyMs = 0;

    if (responseDelay > 0) {
      await new Promise((resolve) => setTimeout(resolve, responseDelay));
    }

    if (state.forceError) {
      return res.status(state.errorStatus).json({
        ok: false,
        error: "erro simulado"
      });
    }

    return res.status(200).json({
      score: 100,
      query: req.query,
      generatedAt: new Date().toISOString()
    });
  });

  app.post("/__control", (req, res) => {
    const { baseDelayMs, forceError, errorStatus } = req.body;

    if (typeof baseDelayMs === "number") {
      state.baseDelayMs = baseDelayMs;
    }
    if (typeof forceError === "boolean") {
      state.forceError = forceError;
    }
    if (typeof errorStatus === "number") {
      state.errorStatus = errorStatus;
    }

    res.status(200).json({ ok: true, state });
  });

  app.post("/__reset", (_req, res) => {
    state.totalRequests = 0;
    state.penaltyCount = 0;
    state.pendingPenaltyMs = 0;
    state.lastRequestAt = 0;
    state.requestTimestamps = [];
    state.lastRequestQuery = null;
    state.baseDelayMs = 0;
    state.forceError = false;
    state.errorStatus = 500;
    res.status(200).json({ ok: true });
  });

  app.get("/__stats", (_req, res) => {
    res.status(200).json(state);
  });

  const server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });

  const { port } = server.address();

  return {
    url: `http://127.0.0.1:${port}`,
    stop: () =>
      new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      })
  };
}
