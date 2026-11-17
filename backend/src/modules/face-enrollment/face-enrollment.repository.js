import { Op } from "sequelize";
import FaceEnrollment from "./face-enrollment.model.js";
import Employee from "../employee/employee.model.js";
import Attendance from "../attendance/attendance.model.js";
import Camera from "../camera/camera.model.js";

export const createFaceEnrollment = async (data) => {
  return FaceEnrollment.create(data);
};

export const findAllFaceEnrollments = async () => {
  const enrollments = await FaceEnrollment.findAll({
    where: {
      employeeId: { [Op.ne]: null }
    },
    // Keep the registry table response small. Embeddings and full scan history
    // are only needed by recognition and the enrollment detail view.
    attributes: ["id", "employeeId", "createdAt", "images", "status", "photoUrl"],
    include: [
      {
        model: Employee,
        as: "employee",
        attributes: ["id", "employeeCode", "firstName", "lastName", "department", "designation"],
        include: [
          {
            model: Attendance,
            as: "attendances",
            separate: true,
            limit: 1,
            order: [["timestamp", "DESC"]],
            // Sequelize needs the FK selected by the per-employee subquery for
            // the outer camera join, even though the list response omits it.
            attributes: ["id", "timestamp", "eventType", "similarity", "status", "source", "createdAt", "cameraId"],
            include: [{ model: Camera, as: "camera", attributes: ["id", "name", "location"] }]
          }
        ]
      }
    ],
    order: [["createdAt", "DESC"]],
  });

  // Keep the existing API payload shape: cameraId is only an internal join key;
  // the nested camera object remains available to existing consumers.
  for (const enrollment of enrollments) {
    for (const attendance of enrollment.employee?.attendances || []) {
      delete attendance.dataValues.cameraId;
    }
  }

  return enrollments;
};

export const findUnknownFaceEnrollments = async () => {
  return FaceEnrollment.findAll({
    where: {
      employeeId: null,
      status: { [Op.in]: ['UNASSIGNED', 'UNREGISTERED', 'REGISTERED', 'COMPLETED'] }
    },
    include: [{ model: Employee, as: "employee", attributes: ["id", "employeeCode", "firstName", "lastName"] }],
    order: [["createdAt", "DESC"]],
  });
};

export const findRecentUnregisteredFace = async (timeLimit) => {
  return FaceEnrollment.findOne({
    where: {
      employeeId: null,
      status: 'UNREGISTERED',
      [Op.or]: [
        { createdAt: { [Op.gte]: timeLimit } },
        { updatedAt: { [Op.gte]: timeLimit } }
      ]
    },
    order: [["updatedAt", "DESC"]]
  });
};

export const findFaceEnrollmentById = async (id) => {
  return FaceEnrollment.findByPk(id, {
    include: [
      {
        model: Employee,
        as: "employee",
        attributes: ["id", "employeeCode", "firstName", "lastName", "department", "designation"],
        include: [
          {
            model: Attendance,
            as: "attendances",
            attributes: ["id", "timestamp", "eventType", "similarity", "status", "source", "createdAt"],
            include: [{ model: Camera, as: "camera", attributes: ["id", "name", "location"] }]
          }
        ]
      }
    ],
    order: [
      [{ model: Employee, as: "employee" }, { model: Attendance, as: "attendances" }, "timestamp", "DESC"]
    ]
  });
};

export const findFaceEnrollmentByEmployeeId = async (employeeId) => {
  return FaceEnrollment.findOne({
    where: { employeeId },
    include: [
      {
        model: Employee,
        as: "employee",
        attributes: ["id", "employeeCode", "firstName", "lastName", "department", "designation"],
        include: [
          {
            model: Attendance,
            as: "attendances",
            attributes: ["id", "timestamp", "eventType", "similarity", "status", "source", "createdAt"],
            include: [{ model: Camera, as: "camera", attributes: ["id", "name", "location"] }]
          }
        ]
      }
    ],
    order: [
      [{ model: Employee, as: "employee" }, { model: Attendance, as: "attendances" }, "timestamp", "DESC"]
    ]
  });
};

export const updateFaceEnrollment = async (enrollment, data) => {
  return enrollment.update(data);
};

export const deleteFaceEnrollment = async (enrollment) => {
  return enrollment.destroy();
};

export const deleteBulkFaceEnrollments = async (ids) => {
  return FaceEnrollment.destroy({
    where: {
      id: { [Op.in]: ids }
    }
  });
};

