import { DataTypes } from "sequelize";
import sequelize from "../../config/database.js";

const Holiday = sequelize.define(
  "Holiday",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    name: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    date: {
      type: DataTypes.DATEONLY,
      allowNull: false,
      unique: true,
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
  },
  {
    tableName: "holidays",
    timestamps: true,
  }
);

export default Holiday;
