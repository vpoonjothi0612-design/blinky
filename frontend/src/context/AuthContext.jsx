import React, { createContext, useState, useEffect } from 'react';
import { getToken, getUser, setToken, setUser, clearAuth } from '../utils/storage';
import { loginApi } from '../modules/auth/auth.service';

export const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUserState] = useState(null);
  const [token, setTokenState] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const storedToken = getToken();
    const storedUser = getUser();

    if (storedToken && storedUser) {
      setTokenState(storedToken);
      setUserState(storedUser);
    }
    setLoading(false);
  }, []);

  const login = async (credentials) => {
    const responseData = await loginApi(credentials);
    const { token: newToken, user: newUser } = responseData.data || {};

    if (newToken && newUser) {
      setToken(newToken);
      setUser(newUser);
      setTokenState(newToken);
      setUserState(newUser);
    }

    return responseData;
  };

  const logout = () => {
    clearAuth();
    setTokenState(null);
    setUserState(null);
  };

  const updateUser = (updatedFields) => {
    const updated = { ...(user || {}), ...updatedFields };
    setUser(updated);
    setUserState(updated);
    return updated;
  };

  const value = {
    user,
    token,
    isAuthenticated: !!token,
    loading,
    login,
    logout,
    updateUser,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export default AuthContext;
