import React from 'react';
import { createContext, useContext } from "react";

const mockUser = {
  id: 1,
  email: "test@example.com",
  companyName: "Ald-a Furniture"
};

// Simple auth context with mock data
const AuthContext = createContext({
  user: mockUser,
  loading: false,
  login: async () => {},
  register: async () => {},
  logout: () => {}
});

// Simplified AuthProvider component
export function AuthProvider(props) {
  const authValue = {
    user: mockUser,
    loading: false,
    login: async () => {},
    register: async () => {},
    logout: () => {}
  };

  return React.createElement(
    AuthContext.Provider,
    { value: authValue },
    props.children
  );
}

// Hook to use auth context
export function useAuth() {
  return useContext(AuthContext);
}
