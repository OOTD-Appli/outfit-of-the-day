export const LOGO_CONFIG = {
  default: {
    emoji: '⭐',
    frameBorderColor: null,
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
    emoji: '⭐',
    frameBorderColor: '#FFE566',
    postIcon: '⭐',
    badge: null,
  },
  bleu_neon: {
    frameBorderColor: '#4A9EFF',
    postIcon: null,
    badge: null,
    image: require('../assets/logos/bleu_neon.jpg'),
  },
  sunset: {
    frameBorderColor: '#FF6EC7',
    postIcon: null,
    badge: null,
    image: require('../assets/logos/sunset.jpg'),
  },
  vert_neon: {
    frameBorderColor: '#4AFF7A',
    postIcon: null,
    badge: null,
    image: require('../assets/logos/vert_neon.jpg'),
  },
  rose_flashy: {
    frameBorderColor: '#FF47C7',
    postIcon: null,
    badge: null,
    image: require('../assets/logos/rose_flashy.jpg'),
  },
  rose_pastel: {
    frameBorderColor: '#FFAAD5',
    postIcon: null,
    badge: null,
    image: require('../assets/logos/rose_pastel.jpg'),
  },
};

export function getLogoConfig(logoId) {
  return LOGO_CONFIG[logoId] || LOGO_CONFIG.default;
}
