require("dotenv").config();
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
  connectionTimeoutMillis: 10000,
});

// =====================================================
// Get uncoded visits
// =====================================================

async function getUncodedVisits() {
  const query = `
    SELECT visit_key
    FROM warehouse.him_coding_worklist
    WHERE LOWER(coding_status) <> 'coded'
      AND is_downloaded = 0;
  `;

  const result = await pool.query(query);

  return result.rows.map((row) => ({
    visitKey: row.visit_key,
    visitNumber: row.visit_key.replace(/^V-/, ""),
  }));
}

// =====================================================
// Get visits where updatedtime is NULL
// =====================================================

async function getPendingVisitKeys() {
  const query = `
    SELECT visit_key
    FROM warehouse.him_patient_document
    WHERE notes IS NULL AND updatedtime IS NULL;
  `;

  const result = await pool.query(query);

  return result.rows.map((row) => row.visit_key);
}

// =====================================================
// Mark visit as downloaded
// =====================================================

async function markVisitAsDownloaded(visitKey) {
  const query = `
    UPDATE warehouse.him_coding_worklist
    SET is_downloaded = 1
    WHERE visit_key = $1;
  `;

  await pool.query(query, [visitKey]);

  console.log(`Database updated: ${visitKey} -> is_downloaded = 1`);
}

async function insertBotSchedulerRunInfo(botName, startedAt, endedAt, status) {
  const query = `
    CALL rpa_capture.insert_botschedulerun_info(
      $1::varchar,
      $2::timestamptz,
      $3::timestamptz,
      $4::varchar
    );
  `;

  await pool.query(query, [botName, startedAt, endedAt, status]);
}

// =====================================================
// Get visits where updatedtime is NULL
// =====================================================

async function fetch_updated_records() {
  const query = `
    SELECT visit_key
    FROM warehouse.him_patient_document
    WHERE updatedtime IS NOT NULL and orders IS NULL;
  `;

  const result = await pool.query(query);

  return result.rows.map((row) => row.visit_key);
}

async function getVisitsWithMissingDocuments(visitKeys) {
  if (!Array.isArray(visitKeys) || visitKeys.length === 0) {
    return [];
  }

  const query = `
    SELECT
      visit_key,
      REPLACE(visit_key, 'V-', '') AS visit_number
    FROM warehouse.him_coding_worklist
    WHERE visit_key = ANY($1::text[]) AND is_downloaded = 0
    ORDER BY visit_key;
  `;

  const result = await pool.query(query, [visitKeys]);

  return result.rows.map((row) => ({
    visitKey: row.visit_key,
    visitNumber: row.visit_number,
  }));
}

// =====================================================
// Close database
// =====================================================

async function closeDatabase() {
  await pool.end();
}

module.exports = {
  getUncodedVisits,
  getPendingVisitKeys,
  markVisitAsDownloaded,
  insertBotSchedulerRunInfo,
  fetch_updated_records,
  getVisitsWithMissingDocuments,
  closeDatabase,
};
