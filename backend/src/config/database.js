import { Sequelize } from "sequelize";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../../.env") });
dotenv.config();

const sequelize = new Sequelize(
  process.env.DB_NAME,
  process.env.DB_USER,
  process.env.DB_PASSWORD,
  {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    dialect: "postgres",
    logging: false,
  }
);

export const connectDatabase = async () => {
  try {
    await sequelize.authenticate();
    console.log("PostgreSQL connected successfully");
    // Create missing tables first, then add new fields to pre-existing tables below.
    await sequelize.sync();
    try {
      await sequelize.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS raw_password VARCHAR(255);');
    } catch (colErr) {
      console.warn("Could not alter users table:", colErr.message);
    }
    try {
      await sequelize.query('ALTER TABLE attendances ADD COLUMN IF NOT EXISTS captured_image VARCHAR(255);');
    } catch (attErr) {
      console.warn("Could not alter attendances table:", attErr.message);
    }
    // Existing installations keep their table shape unless columns are added explicitly;
    // these fields back the ArcFace vector and multi-photo enrollment data.
    await sequelize.query(`
      ALTER TABLE face_enrollments
        ADD COLUMN IF NOT EXISTS embeddings JSONB,
        ADD COLUMN IF NOT EXISTS embedding_model VARCHAR(255),
        ADD COLUMN IF NOT EXISTS embedding_model_version VARCHAR(255),
        ADD COLUMN IF NOT EXISTS face_passport_path TEXT,
        ADD COLUMN IF NOT EXISTS face_aligned_path TEXT,
        ADD COLUMN IF NOT EXISTS body_path TEXT,
        ADD COLUMN IF NOT EXISTS face_quality_score DOUBLE PRECISION,
        ADD COLUMN IF NOT EXISTS face_reason VARCHAR(80);
    `);
    await sequelize.query(`
      ALTER TABLE surveillance_events
        ADD COLUMN IF NOT EXISTS plate_status VARCHAR(24),
        ADD COLUMN IF NOT EXISTS plate_confidence DOUBLE PRECISION,
        ADD COLUMN IF NOT EXISTS vehicle_type VARCHAR(40),
        ADD COLUMN IF NOT EXISTS gate_name VARCHAR(120),
        ADD COLUMN IF NOT EXISTS detected_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS merged_frame_count INTEGER NOT NULL DEFAULT 1,
        ADD COLUMN IF NOT EXISTS vehicle_image_path VARCHAR(255),
        ADD COLUMN IF NOT EXISTS plate_image_path VARCHAR(255);
    `);
    console.log("Database models synchronized successfully");
  } catch (error) {
    console.error("PostgreSQL connection failed:", error.message);
    throw error;
  }
};

export default sequelize;
