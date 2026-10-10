import { createServer } from "node:http";
import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import helmet from "helmet";
import { errorHandler } from "./http.js";
import { apiRouter } from "./routes/index.js";
import { checkConnection } from "./db.js";
import { runMigrations } from "./migrate.js";
import { databaseTarget } from "./pgConfig.js";
import { privacyHtml } from "./privacyPage.js";
import { attachRealtime } from "./realtime.js";
import { isAllowedBrowserOrigin } from "./corsOrigin.js";

dotenv.config();

const app = express();
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);
app.use(
  cors({
    origin(origin, callback) {
      callback(null, isAllowedBrowserOrigin(origin));
    },
  })
);
app.use(express.json({ limit: "2mb" }));
app.get("/privacy", (_req, res) => {
  res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.type("html").send(privacyHtml);
});
app.use("/api", apiRouter);
app.use(errorHandler);

const port = Number(process.env.PORT || 4000);

runMigrations()
  .then(() => {
    const httpServer = createServer(app);
    attachRealtime(httpServer);
    httpServer.listen(port, "0.0.0.0", () => {
      const target = databaseTarget();
      console.log(`Property API listening on http://0.0.0.0:${port}`);
      checkConnection()
        .then((now) => {
          console.log(`Database connected: ${target}`);
          console.log(`Database time: ${now?.toISOString()}`);
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : "Unknown database error";
          console.error(`Database not connected: ${target}`);
          console.error(message);
        });
    });
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Migration failed";
    console.error(message);
    process.exit(1);
  });
