import { DataTypes } from "sequelize";
import sequelize from "../../config/database.js";
import Employee from "../employee/employee.model.js";

const FaceEnrollment = sequelize.define(
  "FaceEnrollment",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
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
    embedding: {
      type: DataTypes.JSON,
      allowNull: true,
    },
    embeddings: { type: DataTypes.JSON, allowNull: true },
    embeddingModel: { type: DataTypes.STRING, allowNull: true, field: "embedding_model" },
    embeddingModelVersion: { type: DataTypes.STRING, allowNull: true, field: "embedding_model_version" },
    personName: {
      type: DataTypes.STRING,
      allowNull: true,
      field: "person_name",
    },
    entryDate: {
      type: DataTypes.DATEONLY,
      allowNull: true,
      field: "entry_date",
    },
    inTime: {
      type: DataTypes.STRING,
      allowNull: true,
      field: "in_time",
    },
    outTime: {
      type: DataTypes.STRING,
      allowNull: true,
      field: "out_time",
    },
    reason: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    personType: {
      type: DataTypes.STRING,
      allowNull: true,
      field: "person_type",
    },
    companyName: {
      type: DataTypes.STRING,
      field: "company_name"
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    status: {
      type: DataTypes.ENUM("UNASSIGNED", "ASSIGNED", "UNREGISTERED", "REGISTERED", "COMPLETED"),
      defaultValue: "UNREGISTERED",
    },
    images: {
      type: DataTypes.JSON,
      allowNull: true,
    },
    photoUrl: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "photo_url",
    },
    facePassportPath: { type: DataTypes.TEXT, allowNull: true, field: "face_passport_path" },
    faceAlignedPath: { type: DataTypes.TEXT, allowNull: true, field: "face_aligned_path" },
    bodyPath: { type: DataTypes.TEXT, allowNull: true, field: "body_path" },
    faceQualityScore: { type: DataTypes.DOUBLE, allowNull: true, field: "face_quality_score" },
    faceReason: { type: DataTypes.STRING(80), allowNull: true, field: "face_reason" },
  },
  {
    tableName: "face_enrollments",
    timestamps: true,
  }
);

// Associations
Employee.hasOne(FaceEnrollment, { foreignKey: "employeeId", as: "faceEnrollment" });
FaceEnrollment.belongsTo(Employee, { foreignKey: "employeeId", as: "employee" });

export default FaceEnrollment;
