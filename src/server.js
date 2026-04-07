import express from "express";
import { createHttpLogger } from "./utils/logger.js";
import { createProxyRouter } from "./routes/proxyRoutes.js";
import { createSystemRouter } from "./routes/systemRoutes.js";

export function createApp({ proxyService, logger }) {
  const app = express();

  app.use(createHttpLogger(logger));
  app.use(createProxyRouter(proxyService));
  app.use(createSystemRouter(proxyService));

  app.use((error, _req, res, _next) => {
    logger.error({ error }, "erro nao tratado");
    res.status(500).json({
      ok: false,
      error: "erro interno"
    });
  });

  return app;
}
