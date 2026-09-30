import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import pg from "pg";
import { pgConfig } from "../src/pgConfig.js";

dotenv.config();

const dir = path.resolve(import.meta.dirname, "../../supabase/migrations");
const files = fs.readdirSync(dir).filter((file) => file.endsWith(".sql")).sort();

const client = new pg.Client(pgConfig());

await client.connect();
for (const file of files) {
  process.stdout.write(`${file}... `);
  await client.query(fs.readFileSync(path.join(dir, file), "utf8"));
  console.log("ok");
}
await client.end();
console.log("Migrations applied.");
