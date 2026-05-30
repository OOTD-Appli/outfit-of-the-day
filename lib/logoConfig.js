export const LOGO_CONFIG = {
  default: {
    emoji: '⭐',
    frameBorderColor: null,  // null = couleur accent par défaut
    postIcon: null,
    badge: null,
  },
  diamond: {
    emoji: '💎',
    frameBorderColor: '#4FC3F7',
    postIcon: '💎',
    badge: '💎',
  },
  crown: {
    emoji: '👑',
    frameBorderColor: '#FFD700',
    postIcon: '👑',
    badge: '👑',
  },
  fire: {
    emoji: '🔥',
    frameBorderColor: '#FF6B35',
    postIcon: '🔥',
    badge: '🔥',
  },
  star: {
    emoji: '🌟',
    frameBorderColor: '#FFE566',
    postIcon: '🌟',
    badge: '🌟',
  },
};

export function getLogoConfig(logoId) {
  return LOGO_CONFIG[logoId] || LOGO_CONFIG.default;
}
