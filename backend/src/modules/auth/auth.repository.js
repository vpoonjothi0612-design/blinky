import Auth from "./auth.model.js";
import { Op } from "sequelize";

const createUser = async (userData) => {
  return Auth.create(userData);
};

const findByEmail = async (email) => {
  const clean = (email || "").trim().toLowerCase();
  return Auth.findOne({
    where: {
      email: clean,
    },
  });
};

const findByNameOrEmail = async (identifier) => {
  const clean = (identifier || "").trim().toLowerCase();
  return Auth.findOne({
    where: {
      [Op.or]: [
        { email: clean },
        { name: clean },
      ],
    },
  });
};

const findById = async (id) => {
  return Auth.findByPk(id, {
    attributes: {
      exclude: ["password"],
    },
  });
};

const findByIdWithPassword = async (id) => {
  return Auth.findByPk(id);
};

const updateUser = async (id, updateData) => {
  const user = await Auth.findByPk(id);
  if (!user) return null;
  return user.update(updateData);
};

const findAll = async () => {
  return Auth.findAll({
    attributes: {
      exclude: ["password"],
    },
    order: [["created_at", "DESC"]],
  });
};

const deleteUser = async (id) => {
  const user = await Auth.findByPk(id);
  if (!user) return null;
  return user.destroy();
};

export default {
  createUser,
  findByEmail,
  findByNameOrEmail,
  findById,
  findByIdWithPassword,
  updateUser,
  findAll,
  deleteUser,
};
