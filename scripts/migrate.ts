import dotenv from "dotenv";
import { runMigrations } from "../src/migrate.js";

dotenv.config();

runMigrations()
  .then(() => {
    console.log("Migrations are up to date.");
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Migration failed";
    console.error(message);
    process.exit(1);
  });
