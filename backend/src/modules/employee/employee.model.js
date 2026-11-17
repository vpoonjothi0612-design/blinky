import { DataTypes } from "sequelize";
import sequelize from "../../config/database.js";
import Shift from "../shifts/shift.model.js";

const Employee = sequelize.define(
  "Employee",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },

    employeeCode: {
      type: DataTypes.STRING(50),
      allowNull: false,
      unique: true,
      field: "employee_code",
    },

    firstName: {
      type: DataTypes.STRING(100),
      allowNull: false,
      field: "first_name",
    },

    lastName: {
      type: DataTypes.STRING(100),
      allowNull: true,
      field: "last_name",
    },

    email: {
      type: DataTypes.STRING(150),
      allowNull: true,
      unique: true,
    },

    phone: {
      type: DataTypes.STRING(20),
      allowNull: true,
    },

    department: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },

    designation: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },

    joiningDate: {
      type: DataTypes.DATEONLY,
      allowNull: true,
      field: "joining_date",
    },

    shiftId: {
      type: DataTypes.UUID,
      allowNull: true,
      field: "shift_id",
      references: {
        model: Shift,
        key: "id",
      },
    },

    status: {
      type: DataTypes.ENUM("ACTIVE", "INACTIVE"),
      allowNull: false,
      defaultValue: "ACTIVE",
    },
  },
  {
    tableName: "employees",
    timestamps: true,
  }
);

Employee.belongsTo(Shift, { foreignKey: "shiftId", as: "shift" });
Shift.hasMany(Employee, { foreignKey: "shiftId", as: "employees" });

export default Employee;