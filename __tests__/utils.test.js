import { computeNiveau, computeLevelInfo, timeAgo } from '../lib/utils';

// ---------------------------------------------------------------------------
// computeNiveau
// ---------------------------------------------------------------------------

describe('computeNiveau', () => {
  it('retourne le niveau 1 pour 0 points', () => {
    expect(computeNiveau(0)).toBe(1);
  });

  it('reste au niveau 1 pour 99 points (seuil non atteint)', () => {
    expect(computeNiveau(99)).toBe(1);
  });

  it('passe au niveau 2 exactement à 100 points', () => {
    expect(computeNiveau(100)).toBe(2);
  });

  it('reste au niveau 2 pour 101 points', () => {
    expect(computeNiveau(101)).toBe(2);
  });

  it('passe au niveau 3 à 100 + 180 = 280 points', () => {
    // Seuil niveau 2 → 3 : floor(100 * 1.8) = 180 points
    expect(computeNiveau(280)).toBe(3);
  });

  it('reste au niveau 2 à 279 points (seuil niveau 3 non atteint)', () => {
    expect(computeNiveau(279)).toBe(2);
  });

  it('retourne un niveau croissant avec les points', () => {
    const niveauFaible = computeNiveau(100);
    const niveauMoyen = computeNiveau(1000);
    const niveauEleve = computeNiveau(10000);
    expect(niveauFaible).toBeLessThan(niveauMoyen);
    expect(niveauMoyen).toBeLessThan(niveauEleve);
  });

  it('retourne le niveau 1 pour des points négatifs', () => {
    expect(computeNiveau(-50)).toBe(1);
  });

  it('calcule correctement plusieurs niveaux successifs', () => {
    // Niveau 1: 0–99 (seuil=100)
    // Niveau 2: 100–279 (seuil=180)
    // Niveau 3: 280–603 (seuil=floor(180*1.8)=324)
    // Niveau 4: 604+ (seuil=floor(324*1.8)=583)
    expect(computeNiveau(0)).toBe(1);
    expect(computeNiveau(100)).toBe(2);
    expect(computeNiveau(280)).toBe(3);
    expect(computeNiveau(604)).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// computeLevelInfo
// ---------------------------------------------------------------------------

describe('computeLevelInfo', () => {
  it('retourne le seuil initial de 100 pour 0 points', () => {
    const { threshold } = computeLevelInfo(0);
    expect(threshold).toBe(100);
  });

  it('retourne progressInLevel = 0 pour 0 points', () => {
    const { progressInLevel } = computeLevelInfo(0);
    expect(progressInLevel).toBe(0);
  });

  it('retourne percent = 0 pour 0 points', () => {
    const { percent } = computeLevelInfo(0);
    expect(percent).toBe(0);
  });

  it('retourne percent = 50 à mi-chemin du niveau 1 (50 pts sur 100)', () => {
    const { percent } = computeLevelInfo(50);
    expect(percent).toBe(50);
  });

  it('retourne percent = 99 pour 99 points sur 100', () => {
    const { percent } = computeLevelInfo(99);
    expect(percent).toBe(99);
  });

  it('plafonne percent à 100 (ne dépasse jamais 100)', () => {
    // Juste au seuil de passage de niveau
    const { percent } = computeLevelInfo(100);
    expect(percent).toBeLessThanOrEqual(100);
  });

  it('retourne progressInLevel correct dans le niveau 2 (180 pts de seuil)', () => {
    // Au niveau 2, cumulatif = 100, seuil = 180
    // Avec pts = 150 : progressInLevel = 150 - 100 = 50
    const { progressInLevel, threshold } = computeLevelInfo(150);
    expect(progressInLevel).toBe(50);
    expect(threshold).toBe(180);
  });

  it('retourne percent correct pour la progression dans le niveau 2', () => {
    // pts = 190 → niveau 2, progress = 190 - 100 = 90, seuil = 180
    // percent = round(90/180 * 100) = 50
    const { percent } = computeLevelInfo(190);
    expect(percent).toBe(50);
  });

  it('retourne un objet avec threshold, progressInLevel et percent', () => {
    const info = computeLevelInfo(0);
    expect(info).toHaveProperty('threshold');
    expect(info).toHaveProperty('progressInLevel');
    expect(info).toHaveProperty('percent');
  });

  it('percent est toujours entre 0 et 100 inclus pour des points élevés', () => {
    const ptsEleves = [500, 1000, 5000, 99999];
    ptsEleves.forEach((pts) => {
      const { percent } = computeLevelInfo(pts);
      expect(percent).toBeGreaterThanOrEqual(0);
      expect(percent).toBeLessThanOrEqual(100);
    });
  });
});

// ---------------------------------------------------------------------------
// timeAgo
// ---------------------------------------------------------------------------

describe('timeAgo', () => {
  it("retourne \"à l'instant\" pour une date il y a moins de 60 secondes", () => {
    const dateRecente = new Date(Date.now() - 30 * 1000).toISOString();
    expect(timeAgo(dateRecente)).toBe("à l'instant");
  });

  it("retourne \"à l'instant\" pour une date identique au moment présent", () => {
    const datePresente = new Date(Date.now()).toISOString();
    expect(timeAgo(datePresente)).toBe("à l'instant");
  });

  it('retourne le nombre de minutes pour une date il y a 2 minutes', () => {
    const dateIlYA2Min = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    expect(timeAgo(dateIlYA2Min)).toBe('2 min');
  });

  it('retourne "59 min" pour une date il y a 59 minutes', () => {
    const dateIlYA59Min = new Date(Date.now() - 59 * 60 * 1000).toISOString();
    expect(timeAgo(dateIlYA59Min)).toBe('59 min');
  });

  it('retourne les heures pour une date il y a 2 heures', () => {
    const dateIlYA2h = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
    expect(timeAgo(dateIlYA2h)).toBe('2 h');
  });

  it('retourne "23 h" pour une date il y a 23 heures', () => {
    const dateIlYA23h = new Date(Date.now() - 23 * 3600 * 1000).toISOString();
    expect(timeAgo(dateIlYA23h)).toBe('23 h');
  });

  it('retourne les jours pour une date il y a 1 jour', () => {
    const dateIlYA1j = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    expect(timeAgo(dateIlYA1j)).toBe('1 j');
  });

  it('retourne "3 j" pour une date il y a 3 jours', () => {
    const dateIlYA3j = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString();
    expect(timeAgo(dateIlYA3j)).toBe('3 j');
  });

  it('accepte un objet Date en plus d\'une string ISO', () => {
    const dateObj = new Date(Date.now() - 5 * 60 * 1000);
    expect(timeAgo(dateObj)).toBe('5 min');
  });

  it('gère la frontière exacte entre "à l\'instant" et les minutes (60 secondes)', () => {
    // 60 secondes → 1 min (plus "à l'instant")
    const dateFrontiere = new Date(Date.now() - 60 * 1000).toISOString();
    expect(timeAgo(dateFrontiere)).toBe('1 min');
  });

  it('gère la frontière exacte entre minutes et heures (3600 secondes)', () => {
    // 3600 secondes → 1 h (plus en minutes)
    const dateFrontiere = new Date(Date.now() - 3600 * 1000).toISOString();
    expect(timeAgo(dateFrontiere)).toBe('1 h');
  });

  it('gère la frontière exacte entre heures et jours (86400 secondes)', () => {
    // 86400 secondes → 1 j (plus en heures)
    const dateFrontiere = new Date(Date.now() - 86400 * 1000).toISOString();
    expect(timeAgo(dateFrontiere)).toBe('1 j');
  });
});
