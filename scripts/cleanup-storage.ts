import { processStorageDeletions } from "../src/services/accountDeletion.js";
import { pool } from "../src/db.js";
try { console.log(`Deleted ${await processStorageDeletions()} queued storage objects.`); }
finally { await pool.end(); }
