import { retryPlayConsumption } from "../src/services/playBilling.js";
import { pool } from "../src/db.js";
try { console.log(`Finalized ${await retryPlayConsumption()} Play purchases.`); }
finally { await pool.end(); }
