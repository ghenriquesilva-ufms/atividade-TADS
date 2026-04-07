import { Router } from "express";

export function createSystemRouter(proxyService) {
  const router = Router();

  router.get("/metrics", (_req, res) => {
    res.status(200).json(proxyService.getMetrics());
  });

  router.get("/health", (_req, res) => {
    res.status(200).json(proxyService.getHealth());
  });

  return router;
}
