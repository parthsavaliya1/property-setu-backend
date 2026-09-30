import dotenv from "dotenv";
import pg from "pg";
import { pgConfig } from "../src/pgConfig.js";

dotenv.config();

const client = new pg.Client(pgConfig());

await client.connect();
const tables = await client.query(
  "select count(*)::int n from pg_tables where schemaname = 'public' and tablename <> 'spatial_ref_sys'"
);
const policies = await client.query("select count(*)::int n from pg_policies where schemaname = 'public'");
const categories = await client.query("select count(*)::int n from property_categories");
const nullable = await client.query(
  `select column_name, is_nullable
   from information_schema.columns
   where table_name = 'properties' and column_name in ('owner_id', 'agency_id', 'agent_id')
   order by column_name`
);
if (tables.rows[0].n < 29) throw new Error(`Expected the marketplace tables, found ${tables.rows[0].n}`);
if (policies.rows[0].n < 70) throw new Error("RLS policies are missing");
if (categories.rows[0].n < 20) throw new Error("Category seed is missing");
const owner = nullable.rows.find((row) => row.column_name === "owner_id");
const agency = nullable.rows.find((row) => row.column_name === "agency_id");
const agent = nullable.rows.find((row) => row.column_name === "agent_id");
if (owner?.is_nullable !== "NO" || agency?.is_nullable !== "YES" || agent?.is_nullable !== "NO" && agent?.is_nullable !== "YES") {
  throw new Error(`Unexpected nullability: ${JSON.stringify(nullable.rows)}`);
}
if (agent?.is_nullable !== "YES") throw new Error("agent_id must stay optional");
console.log("Schema checks passed.", {
  tables: tables.rows[0].n,
  policies: policies.rows[0].n,
  categories: categories.rows[0].n,
});
await client.end();
