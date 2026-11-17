import { DataTypes } from "sequelize";
import sequelize from "../../config/database.js";
import Employee from "../employee/employee.model.js";
import Camera from "../camera/camera.model.js";

const Attendance = sequelize.define(
  "Attendance",
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
    cameraId: {
      type: DataTypes.UUID,
      allowNull: true,
      field: "camera_id",
      references: {
        model: Camera,
        key: "id",
      },
    },
    timestamp: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    eventType: {
      type: DataTypes.ENUM("IN", "OUT"),
      allowNull: false,
      defaultValue: "IN",
      field: "event_type",
    },
    similarity: {
      type: DataTypes.FLOAT,
      allowNull: true,
    },
    eventId: {
      type: DataTypes.STRING(100),
      allowNull: true,
      field: "event_id",
      unique: true,
    },
    status: {
      type: DataTypes.ENUM("PRESENT", "ABSENT", "LATE", "OVERTIME", "LEAVE", "OD"),
      allowNull: false,
      defaultValue: "PRESENT",
    },
    source: {
      type: DataTypes.ENUM("AI_CAMERA", "MANUAL"),
      allowNull: false,
      defaultValue: "AI_CAMERA",
    },
    capturedImage: {
      type: DataTypes.STRING(255),
      allowNull: true,
      field: "captured_image",
    },
  },
  {
    tableName: "attendances",
    timestamps: true,
  },
);

Employee.hasMany(Attendance, { foreignKey: "employeeId", as: "attendances" });
Attendance.belongsTo(Employee, { foreignKey: "employeeId", as: "employee" });

Camera.hasMany(Attendance, { foreignKey: "cameraId", as: "attendances" });
Attendance.belongsTo(Camera, { foreignKey: "cameraId", as: "camera" });

export default Attendance;
