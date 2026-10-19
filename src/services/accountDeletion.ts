import { pool } from "../db.js";
import { HttpError } from "../errors.js";
import { deleteStoredFile, storageKeyFromUrl } from "./bunnyStorage.js";
import { otpPhoneHash } from "./otp.js";

export async function deleteAccount(userId: string) {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const account = await db.query(`SELECT id, phone FROM accounts WHERE id = $1 FOR UPDATE`, [userId]);
    if (!account.rowCount) throw new HttpError(404, "Account not found");
    if (account.rows[0].phone) await db.query(`DELETE FROM otp_sessions WHERE phone_hash = $1`, [otpPhoneHash(account.rows[0].phone)]);
    // Include legacy files uploaded before ownership tracking was introduced.
    const files = await db.query<{ url: string | null }>(`
      SELECT url FROM user_uploads WHERE user_id = $1
      UNION SELECT avatar_url FROM user_profiles WHERE id = $1
      UNION SELECT i.image_url FROM property_images i JOIN properties p ON p.id = i.property_id WHERE p.owner_id = $1
      UNION SELECT v.video_url FROM property_videos v JOIN properties p ON p.id = v.property_id WHERE p.owner_id = $1
      UNION SELECT v.thumbnail_url FROM property_videos v JOIN properties p ON p.id = v.property_id WHERE p.owner_id = $1
      UNION SELECT d.document_url FROM property_documents d JOIN properties p ON p.id = d.property_id WHERE p.owner_id = $1 OR d.uploaded_by = $1
      UNION SELECT m.attachment_url FROM chat_messages m JOIN conversations c ON c.id = m.conversation_id WHERE m.sender_id = $1 OR c.buyer_id = $1 OR c.owner_id = $1
    `, [userId]);
    for (const file of files.rows) {
      const key = storageKeyFromUrl(file.url);
      if (!key) continue;
      const ownership = await db.query(`SELECT user_id FROM user_uploads WHERE remote_key = $1`, [key]);
      // Never delete another account's file merely because its URL was copied into a listing.
      if (ownership.rows[0] && ownership.rows[0].user_id !== userId) continue;
      await db.query(`INSERT INTO storage_deletion_jobs (remote_key, requires_review) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [key, !ownership.rows[0]]);
    }
    // Remove personal text left behind by ON DELETE SET NULL references.
    await db.query(`DELETE FROM property_inquiries WHERE buyer_id = $1`, [userId]);
    await db.query(`DELETE FROM property_visits WHERE buyer_id = $1`, [userId]);
    await db.query(`DELETE FROM property_reports WHERE reported_by = $1 OR reported_user_id = $1`, [userId]);
    await db.query(`DELETE FROM properties WHERE owner_id = $1`, [userId]);
    await db.query(`DELETE FROM accounts WHERE id = $1`, [userId]);
    await db.query("COMMIT");
  } catch (err) {
    await db.query("ROLLBACK");
    throw err;
  } finally { db.release(); }
}

// Run from the scheduled cleanup command; failed jobs remain durable for retry.
export async function processStorageDeletions(limit = 50, timeBudgetMs = 30000) {
  const db = await pool.connect();
  let completed = 0;
  const deadline = Date.now() + timeBudgetMs;
  try {
    await db.query("BEGIN");
    const jobs = await db.query<{ remote_key: string }>(`SELECT remote_key FROM storage_deletion_jobs WHERE NOT requires_review AND next_attempt_at <= now() ORDER BY created_at LIMIT $1 FOR UPDATE SKIP LOCKED`, [limit]);
    for (const job of jobs.rows) {
      if (Date.now() >= deadline) break;
      try {
        await deleteStoredFile(job.remote_key);
        await db.query(`DELETE FROM storage_deletion_jobs WHERE remote_key = $1`, [job.remote_key]);
        completed++;
      } catch {
        await db.query(`UPDATE storage_deletion_jobs SET attempts = attempts + 1, next_attempt_at = now() + interval '1 hour' WHERE remote_key = $1`, [job.remote_key]);
      }
    }
    await db.query("COMMIT");
    return completed;
  } catch (err) { await db.query("ROLLBACK"); throw err; }
  finally { db.release(); }
}
