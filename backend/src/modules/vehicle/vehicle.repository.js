import Vehicle from "./vehicle.model.js";
import Employee from "../employee/employee.model.js";

export const createVehicle = async (data) => {
  return Vehicle.create(data);
};

export const findAllVehicles = async () => {
  return Vehicle.findAll({
    include: [{ model: Employee, as: "employee", attributes: ["id", "employeeCode", "firstName", "lastName"] }],
    order: [["createdAt", "DESC"]],
  });
};

export const findVehicleById = async (id) => {
  return Vehicle.findByPk(id, {
    include: [{ model: Employee, as: "employee", attributes: ["id", "employeeCode", "firstName", "lastName"] }]
  });
};

export const findVehicleByRegistrationNumber = async (registrationNumber) => {
  return Vehicle.findOne({
    where: { registrationNumber },
    include: [{ model: Employee, as: "employee", attributes: ["id", "employeeCode", "firstName", "lastName"] }]
  });
};

export const updateVehicle = async (vehicle, data) => {
  return vehicle.update(data);
};

export const deleteVehicle = async (vehicle) => {
  return vehicle.destroy();
};
