import { DataTypes } from "sequelize";
import sequelize from "../../config/database.js";
import Employee from "../employee/employee.model.js";

const SurveillanceEvent = sequelize.define(
  "SurveillanceEvent",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    cameraId: {
      type: DataTypes.STRING(50),
      allowNull: false,
      field: "camera_id",
    },
    cameraName: {
      type: DataTypes.STRING(100),
      allowNull: true,
      field: "camera_name",
    },
    direction: {
      type: DataTypes.ENUM("IN", "OUT"),
      allowNull: false,
      defaultValue: "IN",
    },
    eventType: {
      type: DataTypes.STRING(50),
      allowNull: false,
      field: "event_type",
    },
    timestamp: {
      type: DataTypes.STRING(60),
      allowNull: false,
      field: "timestamp",
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
    employeeCode: {
      type: DataTypes.STRING(50),
      allowNull: true,
      field: "employee_code",
    },
    name: {
      type: DataTypes.STRING(100),
      allowNull: true,
      defaultValue: "Unknown",
    },
    department: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    designation: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    matchScore: {
      type: DataTypes.FLOAT,
      allowNull: true,
      field: "match_score",
    },
    plateText: {
      type: DataTypes.STRING(50),
      allowNull: true,
      field: "plate_text",
    },
    rawPlateText: {
      type: DataTypes.STRING(50),
      allowNull: true,
      field: "raw_plate_text",
    },
    plateStatus: { type: DataTypes.STRING(24), allowNull: true, field: "plate_status" },
    plateConfidence: { type: DataTypes.FLOAT, allowNull: true, field: "plate_confidence" },
    vehicleType: { type: DataTypes.STRING(40), allowNull: true, field: "vehicle_type" },
    gateName: { type: DataTypes.STRING(120), allowNull: true, field: "gate_name" },
    detectedAt: { type: DataTypes.DATE, allowNull: true, field: "detected_at" },
    mergedFrameCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1, field: "merged_frame_count" },
    vehicleImagePath: { type: DataTypes.STRING(255), allowNull: true, field: "vehicle_image_path" },
    plateImagePath: { type: DataTypes.STRING(255), allowNull: true, field: "plate_image_path" },
    species: {
      type: DataTypes.STRING(50),
      allowNull: true,
    },
    imageFace: {
      type: DataTypes.STRING(255),
      allowNull: true,
      field: "image_face",
    },
    imagePlate: {
      type: DataTypes.STRING(255),
      allowNull: true,
      field: "image_plate",
    },
    imageFrame: {
      type: DataTypes.STRING(255),
      allowNull: true,
      field: "image_frame",
    },
    alarm: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    metadata: {
      type: DataTypes.JSONB,
      allowNull: true,
    },
  },
  {
    tableName: "surveillance_events",
    timestamps: true,
    indexes: [
      { fields: ["camera_id"] },
      { fields: ["direction"] },
      { fields: ["event_type"] },
      { fields: ["createdAt"] },
    ],
  }
);

Employee.hasMany(SurveillanceEvent, { foreignKey: "employeeId", as: "surveillanceEvents" });
SurveillanceEvent.belongsTo(Employee, { foreignKey: "employeeId", as: "employee" });

export default SurveillanceEvent;
