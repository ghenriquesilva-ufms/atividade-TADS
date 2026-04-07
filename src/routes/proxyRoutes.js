import { Router } from "express";

const priorityValues = new Set(["high", "normal", "low"]);

export function createProxyRouter(proxyService) {
  const router = Router();

  router.get("/proxy/score", async (req, res) => {
    const headerPriority = req.header("x-priority")?.toLowerCase() ?? "normal";
    const priority = priorityValues.has(headerPriority)
      ? headerPriority
      : "normal";

    const headerTtlMs = Number.parseInt(req.header("x-ttl-ms"), 10);
    const ttlMs = Number.isNaN(headerTtlMs) ? undefined : headerTtlMs;

    try {
      const result = await proxyService.requestScore(req.query, {
        priority,
        ttlMs
      });

      res.status(200).json({
        ok: true,
        source: result.meta.source,
        reason: result.meta.reason,
        data: result.data
      });
    } catch (error) {
      res.status(error.statusCode ?? 500).json({
        ok: false,
        error: error.message
      });
    }
  });

  return router;
}
