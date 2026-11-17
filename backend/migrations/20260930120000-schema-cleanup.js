export async function up(queryInterface, Sequelize) {
  const transaction = await queryInterface.sequelize.transaction();
  try {
    // 1. Create source enum for attendances
    await queryInterface.sequelize.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_attendances_source') THEN
          CREATE TYPE "enum_attendances_source" AS ENUM ('AI_CAMERA', 'MANUAL');
        END IF;
      END $$;
    `, { transaction });

    // 2. Add source column to attendances
    const attendancesTable = await queryInterface.describeTable('attendances');
    if (!attendancesTable.source) {
      await queryInterface.addColumn('attendances', 'source', {
        type: Sequelize.ENUM('AI_CAMERA', 'MANUAL'),
        allowNull: false,
        defaultValue: 'AI_CAMERA',
      }, { transaction });
    }

    // 3. Create status enum for face_enrollments
    await queryInterface.sequelize.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_face_enrollments_status') THEN
          CREATE TYPE "enum_face_enrollments_status" AS ENUM ('UNASSIGNED', 'ASSIGNED', 'UNREGISTERED', 'REGISTERED', 'COMPLETED');
        END IF;
      END $$;
    `, { transaction });

    // 4. Add images and photo_url to face_enrollments
    const faceEnrollmentsTable = await queryInterface.describeTable('face_enrollments');
    
    if (!faceEnrollmentsTable.images) {
      await queryInterface.addColumn('face_enrollments', 'images', {
        type: Sequelize.JSON,
        allowNull: true,
      }, { transaction });
    }
    
    if (!faceEnrollmentsTable.photo_url) {
      await queryInterface.addColumn('face_enrollments', 'photo_url', {
        type: Sequelize.TEXT,
        allowNull: true,
      }, { transaction });
    }

    if (!faceEnrollmentsTable.status) {
      await queryInterface.addColumn('face_enrollments', 'status', {
        type: Sequelize.ENUM('UNASSIGNED', 'ASSIGNED', 'UNREGISTERED', 'REGISTERED', 'COMPLETED'),
        defaultValue: 'ASSIGNED',
        allowNull: true,
      }, { transaction });
    }

    // 5. Modify face_enrollments employee_id and embedding to be nullable
    // First, check if employee_id allows null
    if (faceEnrollmentsTable.employee_id && faceEnrollmentsTable.employee_id.allowNull === false) {
      await queryInterface.changeColumn('face_enrollments', 'employee_id', {
        type: Sequelize.UUID,
        allowNull: true,
      }, { transaction });
    }

    if (faceEnrollmentsTable.embedding && faceEnrollmentsTable.embedding.allowNull === false) {
      await queryInterface.changeColumn('face_enrollments', 'embedding', {
        type: Sequelize.JSON,
        allowNull: true,
      }, { transaction });
    }

    // 6. Add new columns to face_enrollments
    const newColumns = [
      { name: 'person_name', type: Sequelize.STRING(255) },
      { name: 'entry_date', type: Sequelize.DATEONLY },
      { name: 'in_time', type: Sequelize.STRING(255) },
      { name: 'out_time', type: Sequelize.STRING(255) },
      { name: 'reason', type: Sequelize.STRING(255) },
      { name: 'person_type', type: Sequelize.STRING(255) },
      { name: 'company_name', type: Sequelize.STRING(255) },
      { name: 'notes', type: Sequelize.TEXT }
    ];

    for (const col of newColumns) {
      if (!faceEnrollmentsTable[col.name]) {
        await queryInterface.addColumn('face_enrollments', col.name, {
          type: col.type,
          allowNull: true,
        }, { transaction });
      }
    }

    await transaction.commit();

    // 7. Add ENUM values outside of transaction
    // PostgreSQL does not allow ALTER TYPE ... ADD VALUE inside a transaction block.
    // We use a safe query structure to add them if they don't exist.
    const addEnumValue = async (enumName, value) => {
      try {
        // Query pg_enum to check if the value already exists
        const [results] = await queryInterface.sequelize.query(`
          SELECT 1 FROM pg_enum 
          WHERE enumlabel = '${value}' 
          AND enumtypid = (SELECT oid FROM pg_type WHERE typname = '${enumName}')
        `);
        
        if (results.length === 0) {
          // In Postgres 12+, IF NOT EXISTS is supported natively. However, to be safe across versions
          // and avoid transaction issues, we run it directly.
          await queryInterface.sequelize.query(`ALTER TYPE "${enumName}" ADD VALUE '${value}';`);
        }
      } catch (error) {
        // In case it was created concurrently or another error occurred, log it but don't fail the whole migration
        console.warn(`Warning: Could not add enum value '${value}' to '${enumName}':`, error.message);
      }
    };

    await addEnumValue('enum_attendances_status', 'OVERTIME');
    await addEnumValue('enum_attendances_status', 'ABSENT');
    await addEnumValue('enum_attendances_status', 'LEAVE');
    await addEnumValue('enum_attendances_status', 'OD');

    // face_enrollments status enum values were already included in the CREATE TYPE if it was created above,
    // but if the enum already existed (e.g. created by sequelize.sync() previously), we need to add the new values.
    await addEnumValue('enum_face_enrollments_status', 'UNREGISTERED');
    await addEnumValue('enum_face_enrollments_status', 'REGISTERED');
    await addEnumValue('enum_face_enrollments_status', 'COMPLETED');

  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

export async function down(queryInterface, Sequelize) {
  const transaction = await queryInterface.sequelize.transaction();
  try {
    const faceEnrollmentsTable = await queryInterface.describeTable('face_enrollments');

    const columnsToRemove = [
      'notes', 'company_name', 'person_type', 'reason', 
      'out_time', 'in_time', 'entry_date', 'person_name',
      'status', 'photo_url', 'images'
    ];

    for (const col of columnsToRemove) {
      if (faceEnrollmentsTable[col]) {
        await queryInterface.removeColumn('face_enrollments', col, { transaction });
      }
    }

    const attendancesTable = await queryInterface.describeTable('attendances');
    if (attendancesTable.source) {
      await queryInterface.removeColumn('attendances', 'source', { transaction });
    }

    // Revert nullable columns back to non-null
    if (faceEnrollmentsTable.employee_id) {
      await queryInterface.changeColumn('face_enrollments', 'employee_id', {
        type: Sequelize.UUID,
        allowNull: false,
      }, { transaction });
    }
    
    if (faceEnrollmentsTable.embedding) {
      await queryInterface.changeColumn('face_enrollments', 'embedding', {
        type: Sequelize.JSON,
        allowNull: false,
      }, { transaction });
    }

    await transaction.commit();
    
    // Note: Removing ENUM types or values is complex in PostgreSQL and generally avoided in down migrations
    // to prevent accidental data loss for other tables that might use them. We will leave the ENUMs in the DB.
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}
