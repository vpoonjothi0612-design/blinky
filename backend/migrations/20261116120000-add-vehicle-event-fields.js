export async function up(queryInterface) {
  await queryInterface.sequelize.query(`
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
}

export async function down(queryInterface) {
  await queryInterface.sequelize.query(`
    ALTER TABLE surveillance_events
      DROP COLUMN IF EXISTS plate_status,
      DROP COLUMN IF EXISTS plate_confidence,
      DROP COLUMN IF EXISTS vehicle_type,
      DROP COLUMN IF EXISTS gate_name,
      DROP COLUMN IF EXISTS detected_at,
      DROP COLUMN IF EXISTS merged_frame_count,
      DROP COLUMN IF EXISTS vehicle_image_path,
      DROP COLUMN IF EXISTS plate_image_path;
  `);
}
