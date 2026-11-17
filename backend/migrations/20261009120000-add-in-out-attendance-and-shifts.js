export async function up(queryInterface, Sequelize) {
  const transaction = await queryInterface.sequelize.transaction();
  try {
    // 1. attendances table additions
    const attendancesTable = await queryInterface.describeTable("attendances");

    if (!attendancesTable.event_type) {
      await queryInterface.addColumn(
        "attendances",
        "event_type",
        {
          type: Sequelize.STRING(10),
          allowNull: false,
          defaultValue: "IN",
        },
        { transaction }
      );
    }

    if (!attendancesTable.similarity) {
      await queryInterface.addColumn(
        "attendances",
        "similarity",
        {
          type: Sequelize.FLOAT,
          allowNull: true,
        },
        { transaction }
      );
    }

    if (!attendancesTable.event_id) {
      await queryInterface.addColumn(
        "attendances",
        "event_id",
        {
          type: Sequelize.STRING(100),
          allowNull: true,
        },
        { transaction }
      );
    }

    // 2. shifts table additions
    const shiftsTable = await queryInterface.describeTable("shifts");

    if (!shiftsTable.break_duration) {
      await queryInterface.addColumn(
        "shifts",
        "break_duration",
        {
          type: Sequelize.INTEGER,
          allowNull: false,
          defaultValue: 60,
        },
        { transaction }
      );
    }

    if (!shiftsTable.is_cross_midnight) {
      await queryInterface.addColumn(
        "shifts",
        "is_cross_midnight",
        {
          type: Sequelize.BOOLEAN,
          allowNull: false,
          defaultValue: false,
        },
        { transaction }
      );
    }

    // 3. employees table - shift_id
    const employeesTable = await queryInterface.describeTable("employees");
    if (!employeesTable.shift_id) {
      await queryInterface.addColumn(
        "employees",
        "shift_id",
        {
          type: Sequelize.UUID,
          allowNull: true,
          references: {
            model: "shifts",
            key: "id",
          },
          onUpdate: "CASCADE",
          onDelete: "SET NULL",
        },
        { transaction }
      );
    }

    // 4. holidays table
    await queryInterface.sequelize.query(`
      CREATE TABLE IF NOT EXISTS holidays (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL,
        date DATE NOT NULL UNIQUE,
        description TEXT,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );
    `, { transaction });

    // 5. leaves table
    await queryInterface.sequelize.query(`
      CREATE TABLE IF NOT EXISTS leaves (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        start_date DATE NOT NULL,
        end_date DATE NOT NULL,
        type VARCHAR(50) NOT NULL DEFAULT 'CASUAL',
        status VARCHAR(50) NOT NULL DEFAULT 'APPROVED',
        reason TEXT,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );
    `, { transaction });

    // 6. Indexes for attendances
    await queryInterface.sequelize.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_attendances_event_id_unique
      ON attendances (event_id)
      WHERE event_id IS NOT NULL;
    `, { transaction });

    await queryInterface.sequelize.query(`
      CREATE INDEX IF NOT EXISTS idx_attendances_emp_type_time
      ON attendances (employee_id, event_type, timestamp DESC);
    `, { transaction });

    // 7. Seed Default Shift if none exists
    const [shifts] = await queryInterface.sequelize.query(
      "SELECT id FROM shifts LIMIT 1;",
      { transaction }
    );
    let defaultShiftId;
    if (shifts.length === 0) {
      const [insertResult] = await queryInterface.sequelize.query(`
        INSERT INTO shifts (id, name, start_time, end_time, grace_period, break_duration, is_cross_midnight, is_active, "createdAt", "updatedAt")
        VALUES (gen_random_uuid(), 'General Shift', '09:00:00', '18:00:00', 15, 60, false, true, NOW(), NOW())
        RETURNING id;
      `, { transaction });
      defaultShiftId = insertResult[0]?.id;
    } else {
      defaultShiftId = shifts[0].id;
    }

    // Assign default shift to employees without shift
    if (defaultShiftId) {
      await queryInterface.sequelize.query(`
        UPDATE employees
        SET shift_id = '${defaultShiftId}'
        WHERE shift_id IS NULL;
      `, { transaction });
    }

    // 8. Seed Cameras CAM-01 (OUT) and CAM-02 (IN)
    const [cam1] = await queryInterface.sequelize.query(
      "SELECT id FROM cameras WHERE name = 'CAM-01' OR ip_address = '192.168.9.207';",
      { transaction }
    );
    if (cam1.length === 0) {
      await queryInterface.sequelize.query(`
        INSERT INTO cameras (id, name, location, ip_address, rtsp_url, status, "createdAt", "updatedAt")
        VALUES (
          gen_random_uuid(),
          'CAM-01',
          'Exit / OUT',
          '192.168.9.207',
          'rtsps://192.168.9.207:554/video/live?channel=1&subtype=1&unicast=true&proto=Onvif',
          'ACTIVE',
          NOW(),
          NOW()
        );
      `, { transaction });
    }

    const [cam2] = await queryInterface.sequelize.query(
      "SELECT id FROM cameras WHERE name = 'CAM-02' OR ip_address = '192.168.9.208';",
      { transaction }
    );
    if (cam2.length === 0) {
      await queryInterface.sequelize.query(`
        INSERT INTO cameras (id, name, location, ip_address, rtsp_url, status, "createdAt", "updatedAt")
        VALUES (
          gen_random_uuid(),
          'CAM-02',
          'Entrance / IN',
          '192.168.9.208',
          'rtsps://192.168.9.208:554/video/live?channel=1&subtype=1&unicast=true&proto=Onvif',
          'ACTIVE',
          NOW(),
          NOW()
        );
      `, { transaction });
    }

    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

export async function down(queryInterface, Sequelize) {
  const transaction = await queryInterface.sequelize.transaction();
  try {
    await queryInterface.sequelize.query("DROP TABLE IF EXISTS leaves;", { transaction });
    await queryInterface.sequelize.query("DROP TABLE IF EXISTS holidays;", { transaction });

    const employeesTable = await queryInterface.describeTable("employees");
    if (employeesTable.shift_id) {
      await queryInterface.removeColumn("employees", "shift_id", { transaction });
    }

    const shiftsTable = await queryInterface.describeTable("shifts");
    if (shiftsTable.break_duration) {
      await queryInterface.removeColumn("shifts", "break_duration", { transaction });
    }
    if (shiftsTable.is_cross_midnight) {
      await queryInterface.removeColumn("shifts", "is_cross_midnight", { transaction });
    }

    const attendancesTable = await queryInterface.describeTable("attendances");
    if (attendancesTable.event_type) {
      await queryInterface.removeColumn("attendances", "event_type", { transaction });
    }
    if (attendancesTable.similarity) {
      await queryInterface.removeColumn("attendances", "similarity", { transaction });
    }
    if (attendancesTable.event_id) {
      await queryInterface.removeColumn("attendances", "event_id", { transaction });
    }

    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}
