export async function up(queryInterface, Sequelize) {
  await queryInterface.addColumn("face_enrollments", "face_passport_path", {
    type: Sequelize.TEXT,
    allowNull: true,
  });
  await queryInterface.addColumn("face_enrollments", "face_aligned_path", {
    type: Sequelize.TEXT,
    allowNull: true,
  });
  await queryInterface.addColumn("face_enrollments", "body_path", {
    type: Sequelize.TEXT,
    allowNull: true,
  });
  await queryInterface.addColumn("face_enrollments", "face_quality_score", {
    type: Sequelize.DOUBLE,
    allowNull: true,
  });
  await queryInterface.addColumn("face_enrollments", "face_reason", {
    type: Sequelize.STRING(80),
    allowNull: true,
  });
}

export async function down(queryInterface) {
  await queryInterface.removeColumn("face_enrollments", "face_reason");
  await queryInterface.removeColumn("face_enrollments", "face_quality_score");
  await queryInterface.removeColumn("face_enrollments", "body_path");
  await queryInterface.removeColumn("face_enrollments", "face_aligned_path");
  await queryInterface.removeColumn("face_enrollments", "face_passport_path");
}
