import { DataTypes } from "sequelize";
import sequelize from "../../config/database.js";
import Employee from "../employee/employee.model.js";

const Leave = sequelize.define(
  "Leave",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    employeeId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: "employee_id",
      references: {
        model: Employee,
        key: "id",
      },
    },
    startDate: {
      type: DataTypes.DATEONLY,
      allowNull: false,
      field: "start_date",
    },
    endDate: {
      type: DataTypes.DATEONLY,
      allowNull: false,
      field: "end_date",
    },
    type: {
      type: DataTypes.STRING(50),
      allowNull: false,
      defaultValue: "CASUAL",
    },
    status: {
      type: DataTypes.STRING(50),
      allowNull: false,
      defaultValue: "APPROVED",
    },
    reason: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
  },
  {
    tableName: "leaves",
    timestamps: true,
  }
);

Employee.hasMany(Leave, { foreignKey: "employeeId", as: "leaves" });
Leave.belongsTo(Employee, { foreignKey: "employeeId", as: "employee" });

export default Leave;
