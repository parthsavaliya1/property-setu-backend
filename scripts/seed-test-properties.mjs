// Run from property-backend: node scripts/seed-test-properties.mjs --apply
// Remove only this batch: node scripts/seed-test-properties.mjs --remove
import dotenv from 'dotenv';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';

dotenv.config();
const ownerId = '91e780d2-2495-4a87-b723-5ca323000000';
const email = 'propertysetu-test-listings-20261123@example.invalid';
const samples = [
  ['2 BHK Apartment - Kalawad Road', 'apartment', 'sale', 'Rajkot', 'Kalawad Road', 4800000, 1120, 2, 2, 'semi_furnished', true, false],
  ['3 BHK Villa - Raiya Road', 'villa', 'sale', 'Rajkot', 'Raiya Road', 12500000, 2400, 3, 3, 'furnished', false, true],
  ['1 BHK Flat for Rent - University Road', 'apartment', 'rent', 'Rajkot', 'University Road', 11000, 650, 1, 1, 'unfurnished', false, false],
  ['4 BHK Bungalow - Nana Mava', 'bungalow', 'sale', 'Rajkot', 'Nana Mava', 19000000, 3200, 4, 4, 'furnished', true, false],
  ['Residential Plot - Mavdi', 'residential-plot', 'sale', 'Rajkot', 'Mavdi', 3600000, 1500, null, null, 'unfurnished', false, false],
  ['2 BHK Rental Apartment - Satellite', 'apartment', 'rent', 'Ahmedabad', 'Satellite', 24000, 1250, 2, 2, 'semi_furnished', true, false],
  ['Office for Lease - SG Highway', 'office', 'lease', 'Ahmedabad', 'SG Highway', 60000, 1600, null, 2, 'furnished', false, true],
  ['Retail Shop - Vastrapur', 'shop', 'rent', 'Ahmedabad', 'Vastrapur', 32000, 550, null, 1, 'unfurnished', false, false],
  ['PG Room - Navrangpura', 'apartment', 'pg', 'Ahmedabad', 'Navrangpura', 8500, 280, 1, 1, 'furnished', false, false],
  ['3 BHK Independent House - Chandkheda', 'house', 'sale', 'Ahmedabad', 'Chandkheda', 9200000, 1900, 3, 3, 'semi_furnished', true, false],
];
const ids = samples.map((_, i) => `91e780d2-2495-4a87-b723-5ca323${String(i + 1).padStart(6, '0')}`);
const mode = process.argv[2];
if (!['--apply', '--remove'].includes(mode)) {
  console.log('10 explicitly labeled TEST listings: 5 Rajkot, 5 Ahmedabad.');
  console.table(samples.map(([title, category, type, city, , price]) => ({ title: `[TEST] ${title}`, category, type, city, price })));
  console.log('Use --apply to insert into the database configured in .env, or --remove to remove this batch.');
  process.exit(0);
}
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
const target = new URL(process.env.DATABASE_URL);
console.log(`Database: ${target.hostname}${target.pathname}; mode: ${mode}`);
const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 20000 });
try {
  await client.connect();
  await client.query('BEGIN');
  await client.query("SET LOCAL statement_timeout = '30s'");
  await client.query('SELECT pg_advisory_xact_lock(20261123, 10)');
  if (mode === '--remove') {
    const removed = await client.query('DELETE FROM properties WHERE id = ANY($1::uuid[]) AND owner_id=$2 RETURNING id', [ids, ownerId]);
    await client.query('DELETE FROM accounts WHERE id=$1 AND email=$2 AND NOT EXISTS (SELECT 1 FROM properties WHERE owner_id=$1)', [ownerId, email]);
    await client.query('COMMIT');
    console.log(`Removed ${removed.rowCount} test listings.`);
  } else {
    // Dedicated owner with no phone and a random, unknown password. No real user's profile is changed.
    const existing = await client.query('SELECT email FROM accounts WHERE id=$1', [ownerId]);
    if (existing.rows.length && existing.rows[0].email !== email) throw new Error('Test owner ID collision; no changes made.');
    await client.query('INSERT INTO accounts (id,email,password_hash,password_set) VALUES ($1,$2,$3,false) ON CONFLICT (id) DO NOTHING', [ownerId, email, await bcrypt.hash(randomUUID(), 10)]);
    await client.query("INSERT INTO user_profiles (id,full_name,email,bio,city,state) VALUES ($1,'TEST Property Setu Owner',$2,'Synthetic listings for app testing. Not available for purchase or rent.','Rajkot','Gujarat') ON CONFLICT (id) DO NOTHING", [ownerId, email]);
    const categories = new Map((await client.query('SELECT id,slug FROM property_categories WHERE is_active=true')).rows.map(r => [r.slug, r.id]));
    // Reuse existing public property photos as sample images; no storage uploads or external API calls.
    const photos = (await client.query("SELECT DISTINCT image_url FROM property_images WHERE image_url LIKE 'https://%' ORDER BY image_url LIMIT 20")).rows.map(r => r.image_url);
    if (!photos.length) throw new Error('No existing sample property photos are available.');
    let added = 0;
    for (let i = 0; i < samples.length; i++) {
      const [title, category, type, city, locality, price, area, beds, baths, furnishing, premium, featured] = samples[i];
      const categoryId = categories.get(category);
      if (!categoryId) throw new Error(`Missing category: ${category}`);
      const found = await client.query('SELECT owner_id FROM properties WHERE id=$1', [ids[i]]);
      if (found.rows.length) {
        if (found.rows[0].owner_id !== ownerId) throw new Error('Test listing ID collision.');
        continue;
      }
      await client.query(`INSERT INTO properties
        (id,owner_id,category_id,title,slug,description,listing_type,property_type,price,price_unit,area,area_unit,bedrooms,bathrooms,furnishing_status,status,verification_status,is_premium,is_featured,published_at,expires_at,possession_status)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'sq_ft',$12,$13,$14,'published','active',$15,$16,now(),now()+interval '30 days','Ready to move')`,
        [ids[i], ownerId, categoryId, `[TEST] ${title}`, `propertysetu-test-20261123-${i + 1}`,
         `TEST DATA ONLY. Synthetic ${category} listing in ${locality}, ${city}, for testing Property Setu. Not a real offer. Sample photos are reused from existing listings.`,
         type, category, price, type === 'sale' ? 'total' : 'per_month', area, beds, baths, furnishing, premium, featured]);
      await client.query(`INSERT INTO property_locations (property_id,address,locality,city,district,state,pincode,latitude,longitude)
        VALUES ($1,$2,$3,$4,$4,'Gujarat',$5,$6,$7)`,
        [ids[i], `TEST Address ${i + 1}, ${locality}`, locality, city, city === 'Rajkot' ? '360005' : '380015', city === 'Rajkot' ? 22.3039 + i * 0.002 : 23.0225 + (i - 5) * 0.002, city === 'Rajkot' ? 70.8022 : 72.5714]);
      for (let j = 0; j < 3; j++) {
        const photo = photos[(i * 2 + j) % photos.length];
        await client.query('INSERT INTO property_images (property_id,image_url,thumbnail_url,image_type,is_cover,sort_order) VALUES ($1,$2,$2,$3,$4,$5)', [ids[i], photo, j === 0 ? 'cover' : 'gallery', j === 0, j]);
      }
      await client.query("INSERT INTO property_features (property_id,feature_key,feature_value) VALUES ($1,'listing_term','month'),($1,'test_batch','propertysetu-test-20261123')", [ids[i]]);
      added++;
    }
    const result = await client.query(`SELECT p.title,p.listing_type,p.price,l.city,p.status,
      (SELECT count(*) FROM property_images i WHERE i.property_id=p.id) AS photos
      FROM properties p JOIN property_locations l ON l.property_id=p.id
      WHERE p.id=ANY($1::uuid[]) AND p.owner_id=$2 ORDER BY p.slug`, [ids, ownerId]);
    if (result.rows.length !== 10 || result.rows.some(r => r.status !== 'published' || Number(r.photos) !== 3)) throw new Error('Test listing verification failed.');
    await client.query('SET LOCAL ROLE anon');
    const visible = await client.query("SELECT count(*) FROM properties WHERE id=ANY($1::uuid[]) AND status='published' AND expires_at>now() AND public.account_active(owner_id)", [ids]);
    if (Number(visible.rows[0].count) !== 10) throw new Error('Test listings are not all publicly visible.');
    await client.query('COMMIT');
    console.table(result.rows);
    console.log(`Added ${added} listings; verified 10 published listings with 3 photos each, visible to anonymous users.`);
  }
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  throw error;
} finally {
  await client.end();
}
