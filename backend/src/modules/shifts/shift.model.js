import { DataTypes } from "sequelize";
import sequelize from "../../config/database.js";

const Shift = sequelize.define(
  "Shift",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    name: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    startTime: {
      type: DataTypes.TIME,
      allowNull: false,
      field: "start_time",
    },
    endTime: {
      type: DataTypes.TIME,
      allowNull: false,
      field: "end_time",
    },
    gracePeriod: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      field: "grace_period", // in minutes
    },
    breakDuration: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 60,
      field: "break_duration", // in minutes
    },
    isCrossMidnight: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      field: "is_cross_midnight",
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
      field: "is_active",
    },
  },
  {
    tableName: "shifts",
    timestamps: true,
  }
);

export default Shift;
