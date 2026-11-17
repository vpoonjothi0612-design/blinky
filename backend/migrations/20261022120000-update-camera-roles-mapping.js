/**
 * Migration: Update Camera Roles and Locations
 *
 * Keeps PostgreSQL schema unchanged. Updates metadata in 'cameras' table:
 * - CAM-01 (192.168.9.207) -> Exit / OUT
 * - CAM-02 (192.168.9.208) -> Entrance / IN
 */

export async function up(queryInterface, Sequelize) {
  const transaction = await queryInterface.sequelize.transaction();
  try {
    // 1. Update CAM-01 (192.168.9.207) to Exit / OUT
    await queryInterface.sequelize.query(`
      UPDATE cameras
      SET location = 'Exit / OUT',
          "updatedAt" = NOW()
      WHERE name = 'CAM-01' OR ip_address = '192.168.9.207';
    `, { transaction });

    // 2. Update CAM-02 (192.168.9.208) to Entrance / IN
    await queryInterface.sequelize.query(`
      UPDATE cameras
      SET location = 'Entrance / IN',
          "updatedAt" = NOW()
      WHERE name = 'CAM-02' OR ip_address = '192.168.9.208';
    `, { transaction });

    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

export async function down(queryInterface, Sequelize) {
  const transaction = await queryInterface.sequelize.transaction();
  try {
    await queryInterface.sequelize.query(`
      UPDATE cameras
      SET location = 'Entrance / IN',
          "updatedAt" = NOW()
      WHERE name = 'CAM-01' OR ip_address = '192.168.9.207';
    `, { transaction });

    await queryInterface.sequelize.query(`
      UPDATE cameras
      SET location = 'Exit / OUT',
          "updatedAt" = NOW()
      WHERE name = 'CAM-02' OR ip_address = '192.168.9.208';
    `, { transaction });

    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}
