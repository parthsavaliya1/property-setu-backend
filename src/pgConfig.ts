export function pgConfig() {
  const ssl = { rejectUnauthorized: false as const };
  const connectionString = process.env.DATABASE_URL?.trim();
  if (connectionString) return { connectionString, ssl };
  return {
    host: process.env.PGHOST,
    port: Number(process.env.PGPORT || 5432),
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    database: process.env.PGDATABASE || "postgres",
    ssl,
  };
}

export function databaseTarget() {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    return `${process.env.PGHOST || "localhost"}:${process.env.PGPORT || 5432}/${process.env.PGDATABASE || "postgres"}`;
  }
  try {
    const parsed = new URL(connectionString);
    return `${parsed.hostname}:${parsed.port || "5432"}${parsed.pathname}`;
  } catch {
    return "DATABASE_URL";
  }
}
