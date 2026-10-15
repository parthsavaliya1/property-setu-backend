import { createServer } from "node:http";
import { networkInterfaces } from "node:os";
import cors from "cors";
import dotenv from "dotenv";
import express, { type RequestHandler } from "express";
import * as helmetModule from "helmet";
import type { HelmetOptions } from "helmet";
import { errorHandler, requestLog } from "./http.js";
import { apiRouter } from "./routes/index.js";
import { checkConnection } from "./db.js";
import { runMigrations } from "./migrate.js";
import { databaseTarget } from "./pgConfig.js";
import { privacyHtml } from "./privacyPage.js";
import { attachRealtime } from "./realtime.js";
import { isAllowedBrowserOrigin } from "./corsOrigin.js";

dotenv.config();

// Normalize Helmet's ESM/CommonJS export across local and deployment builds.
const helmet = (
  typeof helmetModule === "function" ? helmetModule : helmetModule.default
) as (options?: HelmetOptions) => RequestHandler;

const app = express();
app.use(requestLog);
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
      console.log(`[backend] Local API URL: http://localhost:${port}/api`);
      for (const addresses of Object.values(networkInterfaces())) {
        for (const address of addresses ?? []) {
          if (address.family === "IPv4" && !address.internal) {
            console.log(`[backend] LAN API URL: http://${address.address}:${port}/api`);
          }
        }
      }
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
