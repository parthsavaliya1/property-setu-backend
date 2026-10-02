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
import { attachRealtime } from "./realtime.js";

dotenv.config();

const app = express();
app.use(helmet());
app.use(
  cors({
    origin: process.env.CORS_ORIGIN?.split(",").map((value) => value.trim()) || [
      "http://localhost:5173",
      "http://localhost:8081",
      "http://localhost:19006",
    ],
  })
);
app.use(express.json({ limit: "2mb" }));
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
