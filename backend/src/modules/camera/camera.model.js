import { DataTypes } from "sequelize";
import sequelize from "../../config/database.js";

const Camera = sequelize.define(
  "Camera",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    name: {
      type: DataTypes.STRING(100),
      allowNull: false,
      unique: true,
    },
    location: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    ipAddress: {
      type: DataTypes.STRING(50),
      allowNull: true,
      field: "ip_address",
    },
    rtspUrl: {
      type: DataTypes.STRING(255),
      allowNull: true,
      field: "rtsp_url",
    },
    status: {
      type: DataTypes.ENUM("ACTIVE", "INACTIVE"),
      allowNull: false,
      defaultValue: "ACTIVE",
    },
  },
  {
    tableName: "cameras",
    timestamps: true,
  }
);

export default Camera;
