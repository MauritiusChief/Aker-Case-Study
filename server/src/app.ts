import express, { type Express } from "express";
import type { AppDatabase } from "./db/index.js";
import { propertiesRouter } from "./routes/properties.routes.js";
import { unitsRouter } from "./routes/units.routes.js";
import { residentsRouter } from "./routes/residents.routes.js";
import { rentRollsRouter } from "./routes/rent-rolls.routes.js";
import { availabilityRouter } from "./routes/availability.routes.js";

export function createApp(db: AppDatabase): Express {
  const app = express();
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.use("/api/properties", propertiesRouter(db));
  app.use("/api/units", unitsRouter(db));
  app.use("/api/residents", residentsRouter(db));
  app.use("/api/rent-rolls", rentRollsRouter(db));
  app.use("/api/availability", availabilityRouter(db));

  app.use(
    (
      err: Error,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction
    ) => {
      console.error(err);
      res.status(500).json({ error: "Internal server error" });
    }
  );

  return app;
}
