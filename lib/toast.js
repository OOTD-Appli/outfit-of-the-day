let listeners = [];

export function subscribe(listener) {
  listeners.push(listener);
  return () => {
    listeners = listeners.filter(l => l !== listener);
  };
}

export function showToast(message, options = {}) {
  const id = Math.random().toString(36).substr(2, 9);
  const toast = {
    id,
    message,
    type: options.type || 'info', // info, success, warning, error
    duration: options.duration ?? 3000,
    ...options,
  };
  listeners.forEach(listener => listener(toast));
  return id;
}

export function dismissToast(id) {
  listeners.forEach(listener => listener({ id, dismiss: true }));
}