import express from "express";

const app = express();
app.use(express.json());

let totalRequests = 0;
let penaltyCount = 0;
let pendingPenaltyMs = 0;
let lastRequestAt = 0;
let baseDelayMs = 0;
let forceError = false;
let errorStatus = 500;

app.get("/score", async (req, res) => {
  const now = Date.now();

  if (lastRequestAt !== 0 && now - lastRequestAt < 1000) {
    pendingPenaltyMs += 2000;
    penaltyCount += 1;
  }

  lastRequestAt = now;
  totalRequests += 1;

  const responseDelay = baseDelayMs + pendingPenaltyMs;
  pendingPenaltyMs = 0;

  if (responseDelay > 0) {
    await new Promise((resolve) => setTimeout(resolve, responseDelay));
  }

  if (forceError) {
    return res.status(errorStatus).json({
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

app.get("/stats", (_req, res) => {
  res.status(200).json({
    totalRequests,
    penaltyCount,
    pendingPenaltyMs,
    baseDelayMs,
    forceError,
    errorStatus
  });
});

app.post("/control", (req, res) => {
  const payload = req.body ?? {};

  if (typeof payload.baseDelayMs === "number") {
    baseDelayMs = payload.baseDelayMs;
  }

  if (typeof payload.forceError === "boolean") {
    forceError = payload.forceError;
  }

  if (typeof payload.errorStatus === "number") {
    errorStatus = payload.errorStatus;
  }

  res.status(200).json({ ok: true });
});

const port = Number.parseInt(process.env.PORT ?? "4001", 10);
app.listen(port, () => {
  console.log(`mock external api escutando na porta ${port}`);
});
