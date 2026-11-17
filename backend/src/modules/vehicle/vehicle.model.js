import { DataTypes } from "sequelize";
import sequelize from "../../config/database.js";
import Employee from "../employee/employee.model.js";

const Vehicle = sequelize.define(
  "Vehicle",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    registrationNumber: {
      type: DataTypes.STRING(50),
      allowNull: false,
      unique: true,
      field: "registration_number",
    },
    type: {
      type: DataTypes.STRING(50),
      allowNull: true,
    },
    make: {
      type: DataTypes.STRING(50),
      allowNull: true,
    },
    model: {
      type: DataTypes.STRING(50),
      allowNull: true,
    },
    color: {
      type: DataTypes.STRING(30),
      allowNull: true,
    },
    employeeId: {
      type: DataTypes.UUID,
      allowNull: true,
      field: "employee_id",
      references: {
        model: Employee,
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
    tableName: "vehicles",
    timestamps: true,
  }
);

Employee.hasMany(Vehicle, { foreignKey: "employeeId", as: "vehicles" });
Vehicle.belongsTo(Employee, { foreignKey: "employeeId", as: "employee" });

export default Vehicle;
