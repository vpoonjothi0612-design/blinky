export async function up(queryInterface) {
  await queryInterface.sequelize.query(`
    CREATE INDEX IF NOT EXISTS idx_attendances_timestamp_employee
    ON attendances (timestamp DESC, employee_id ASC);
  `);
}

export async function down(queryInterface) {
  await queryInterface.sequelize.query(`
    DROP INDEX IF EXISTS idx_attendances_timestamp_employee;
  `);
}
