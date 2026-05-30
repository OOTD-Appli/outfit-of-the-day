import React, { createContext, useContext, useState, useCallback } from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';

const ToastContext = createContext();

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
};

export const ToastProvider = ({ children }) => {
  const [toasts, setToasts] = useState([]);

  const showToast = useCallback((message, options = {}) => {
    const id = Math.random().toString(36).substr(2, 9);
    const toast = {
      id,
      message,
      type: options.type || 'info',
      duration: options.duration ?? 3000,
      ...options,
    };
    setToasts(prev => [...prev, toast]);
    // auto dismiss
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, toast.duration);
    return id;
  }, []);

  const dismissToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const value = {
    showToast,
    dismissToast,
    toasts,
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </ToastContext.Provider>
  );
};

const ToastContainer = ({ toasts, onDismiss }) => {
  if (toasts.length === 0) return null;

  return (
    <View style={styles.container}>
      {toasts.map(toast => (
        <View key={toast.id} style={[styles.toast, styles[toast.type || 'info']]}>
          <Text style={styles.text}>{toast.message}</Text>
        </View>
      ))}
    </View>
  );
};

const baseToast = {
  ...StyleSheet.absoluteFillObject,
  padding: 12,
  justifyContent: 'flex-end',
  alignItems: 'center',
  pointerEvents: 'none',
};

const styles = StyleSheet.create({
  container: {
    ...baseToast,
    bottom: 60,
  },
  toast: {
    backgroundColor: 'rgba(0,0,0,0.8)',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 12,
    minWidth: '60%',
    maxWidth: '80%',
  },
  info: {
    backgroundColor: 'rgba(0,0,0,0.8)',
  },
  success: {
    backgroundColor: 'rgba(40,167,69,0.9)',
  },
  warning: {
    backgroundColor: 'rgba(255,193,7,0.9)',
  },
  error: {
    backgroundColor: 'rgba(220,53,69,0.9)',
  },
  text: {
    color: '#fff',
    fontSize: 14,
    textAlign: 'center',
  },
});
