import React from 'react';
import { createContext, useState, useEffect, useContext } from "react";
import { useLocation } from "wouter";
import { apiRequest } from "./queryClient";
import { useToast } from "@/hooks/use-toast";

const mockUser = {
  id: 1,
  email: "test@example.com",
  companyName: "Ald-a Furniture"
};

// Simple auth context for development
const AuthContext = createContext({
  user: mockUser,
  loading: false,
  login: async () => {},
  register: async () => {},
  logout: () => {}
});

// AuthProvider component
export function AuthProvider(props) {
  const [user, setUser] = useState(mockUser);
  const [loading, setLoading] = useState(false);
  const [, navigate] = useLocation();
  const { toast } = useToast();

  // Login function (mock implementation)
  const login = async () => {
    toast({
      title: "Login bem-sucedido",
      description: `Bem-vindo, ${mockUser.companyName}!`,
    });
    return;
  };

  // Register function (mock implementation)
  const register = async () => {
    toast({
      title: "Registro bem-sucedido",
      description: `Bem-vindo, ${mockUser.companyName}!`,
    });
    return;
  };

  // Logout function (mock implementation)
  const logout = () => {
    toast({
      title: "Logout bem-sucedido",
      description: "Você saiu da sua conta com sucesso",
    });
  };

  const authValue = {
    user,
    loading,
    login,
    register,
    logout
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