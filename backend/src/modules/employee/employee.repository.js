import Employee from "./employee.model.js";
import FaceEnrollment from "../face-enrollment/face-enrollment.model.js";

export const createEmployee = async (data) => {
  return Employee.create(data);
};

export const findAllEmployees = async () => {
  return Employee.findAll({
    attributes: [
      "id",
      "employeeCode",
      "firstName",
      "lastName",
      "email",
      "phone",
      "department",
      "designation",
      "status",
    ],
    include: [{
      model: FaceEnrollment,
      as: "faceEnrollment",
      attributes: ["id", "employeeId"],
    }],
    order: [["createdAt", "DESC"]],
  });
};

export const findEmployeeById = async (id) => {
  return Employee.findByPk(id, {
    include: [{ model: FaceEnrollment, as: "faceEnrollment" }],
  });
};

export const findEmployeeByCode = async (employeeCode) => {
  return Employee.findOne({
    where: { employeeCode },
    include: [{ model: FaceEnrollment, as: "faceEnrollment" }],
  });
};

export const findEmployeeByEmail = async (email) => {
  return Employee.findOne({
    where: { email },
  });
};

export const updateEmployee = async (employee, data) => {
  return employee.update(data);
};

export const deleteEmployee = async (employee) => {
  return employee.destroy();
};

export const bulkDeleteEmployees = async (ids) => {
  return Employee.destroy({
    where: {
      id: ids,
    },
  });
};
