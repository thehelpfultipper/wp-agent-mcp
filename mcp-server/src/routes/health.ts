import { Router } from "express";

export function createHealthRouter(version: string): Router {
  const router = Router();

  router.get("/health", (_req, res) => {
    res.json({
      ok: true,
      version,
      uptime: Math.floor(process.uptime())
    });
  });

  return router;
}
