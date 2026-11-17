import { DataTypes } from "sequelize";
import sequelize from "../../config/database.js";

const Auth = sequelize.define(
  "Auth",
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

    email: {
      type: DataTypes.STRING(150),
      allowNull: false,
      unique: true,
      validate: {
        isEmail: true,
      },
    },

    password: {
      type: DataTypes.STRING,
      allowNull: false,
    },

    rawPassword: {
      type: DataTypes.STRING,
      allowNull: true,
      field: "raw_password",
    },

    role: {
      type: DataTypes.ENUM("ADMIN", "STAFF", "SECURITY", "USER"),
      allowNull: false,
      defaultValue: "USER",
    },

    isActive: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
  },
  {
    tableName: "users",
    timestamps: true,
    underscored: true,
  }
);

export default Auth;
