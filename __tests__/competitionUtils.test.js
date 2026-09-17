import { getLocalDayIsoRange, hasSubmittedTodayForCompetition } from '../lib/competitionUtils';

// ---------------------------------------------------------------------------
// getLocalDayIsoRange (reprise telle quelle de l'ancien lib/flammesUtils.js)
// ---------------------------------------------------------------------------

describe('getLocalDayIsoRange', () => {
  it('retourne un objet avec startIso et endIso', () => {
    const { startIso, endIso } = getLocalDayIsoRange();
    expect(typeof startIso).toBe('string');
    expect(typeof endIso).toBe('string');
  });

  it('startIso correspond à minuit local (hh:mm:ss.ms = 00:00:00.000)', () => {
    const { startIso } = getLocalDayIsoRange();
    const debut = new Date(startIso);
    expect(debut.getHours()).toBe(0);
    expect(debut.getMinutes()).toBe(0);
    expect(debut.getSeconds()).toBe(0);
    expect(debut.getMilliseconds()).toBe(0);
  });

  it('endIso est exactement 24h après startIso', () => {
    const { startIso, endIso } = getLocalDayIsoRange();
    const diffMs = new Date(endIso) - new Date(startIso);
    expect(diffMs).toBe(24 * 60 * 60 * 1000);
  });

  it('startIso < endIso', () => {
    const { startIso, endIso } = getLocalDayIsoRange();
    expect(new Date(startIso) < new Date(endIso)).toBe(true);
  });

  it("l'instant actuel est compris entre startIso et endIso", () => {
    const { startIso, endIso } = getLocalDayIsoRange();
    const maintenant = Date.now();
    expect(maintenant >= new Date(startIso).getTime()).toBe(true);
    expect(maintenant < new Date(endIso).getTime()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// hasSubmittedTodayForCompetition (même forme que l'ancien hasSnapUsedTodayForPair,
// juste compétition_id/user_id à la place de sender_id/receiver_id)
// ---------------------------------------------------------------------------

describe('hasSubmittedTodayForCompetition', () => {
  const competitionId = 'comp-123';
  const userId = 'user-456';

  function creerSupabaseMock({ count, error }) {
    return {
      from: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        gte: jest.fn().mockReturnThis(),
        lt: jest.fn().mockResolvedValue({ count, error }),
      }),
    };
  }

  it('retourne true si count >= 1 (déjà soumis aujourd\'hui)', async () => {
    const supabase = creerSupabaseMock({ count: 1, error: null });
    const dejaSoumis = await hasSubmittedTodayForCompetition(supabase, competitionId, userId);
    expect(dejaSoumis).toBe(true);
  });

  it('retourne true si count > 1 (plusieurs soumissions)', async () => {
    const supabase = creerSupabaseMock({ count: 3, error: null });
    const dejaSoumis = await hasSubmittedTodayForCompetition(supabase, competitionId, userId);
    expect(dejaSoumis).toBe(true);
  });

  it('retourne false si count === 0 (aucune soumission aujourd\'hui)', async () => {
    const supabase = creerSupabaseMock({ count: 0, error: null });
    const dejaSoumis = await hasSubmittedTodayForCompetition(supabase, competitionId, userId);
    expect(dejaSoumis).toBe(false);
  });

  it('retourne false si count est null (traité comme 0)', async () => {
    const supabase = creerSupabaseMock({ count: null, error: null });
    const dejaSoumis = await hasSubmittedTodayForCompetition(supabase, competitionId, userId);
    expect(dejaSoumis).toBe(false);
  });

  it('lève une erreur si Supabase retourne une erreur', async () => {
    const erreurSupabase = new Error('RLS violation');
    const supabase = creerSupabaseMock({ count: null, error: erreurSupabase });
    await expect(hasSubmittedTodayForCompetition(supabase, competitionId, userId)).rejects.toThrow('RLS violation');
  });

  it('interroge ootd_competitions avec les bons filtres competition_id et user_id', async () => {
    const eqMock = jest.fn().mockReturnThis();
    const supabase = {
      from: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: eqMock,
        gte: jest.fn().mockReturnThis(),
        lt: jest.fn().mockResolvedValue({ count: 0, error: null }),
      }),
    };

    await hasSubmittedTodayForCompetition(supabase, competitionId, userId);

    expect(supabase.from).toHaveBeenCalledWith('ootd_competitions');
    expect(eqMock).toHaveBeenCalledWith('competition_id', competitionId);
    expect(eqMock).toHaveBeenCalledWith('user_id', userId);
  });

  it('utilise un filtre de plage sur la journée locale (gte startIso, lt endIso)', async () => {
    const gteMock = jest.fn().mockReturnThis();
    const ltMock = jest.fn().mockResolvedValue({ count: 0, error: null });

    const supabase = {
      from: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        gte: gteMock,
        lt: ltMock,
      }),
    };

    await hasSubmittedTodayForCompetition(supabase, competitionId, userId);

    expect(gteMock).toHaveBeenCalledWith('created_at', expect.any(String));
    expect(ltMock).toHaveBeenCalledWith('created_at', expect.any(String));

    const [, startIso] = gteMock.mock.calls[0];
    const [, endIso] = ltMock.mock.calls[0];
    expect(new Date(startIso).getHours()).toBe(0);
    expect(new Date(endIso) - new Date(startIso)).toBe(24 * 60 * 60 * 1000);
  });
});
