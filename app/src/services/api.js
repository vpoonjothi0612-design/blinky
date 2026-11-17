import axios from "axios";
import { getBaseUrl } from "../config/apiConfig";

let authToken = null;

export const setAuthToken = (token) => {
  authToken = token;
};

const api = axios.create({
  timeout: 10000,
});

api.interceptors.request.use((config) => {
  config.baseURL = getBaseUrl();
  if (authToken) {
    config.headers.Authorization = `Bearer ${authToken}`;
  }
  return config;
});

export default api;

