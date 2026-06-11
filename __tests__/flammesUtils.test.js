import {
  flammeOrderedIds,
  getLocalDayIsoRange,
  fetchAcceptedFriendIds,
  hasSnapUsedTodayForPair,
} from '../lib/flammesUtils';

// ---------------------------------------------------------------------------
// flammeOrderedIds
// ---------------------------------------------------------------------------

describe('flammeOrderedIds', () => {
  it('retourne user1_id < user2_id quand a < b en comparaison de chaînes', () => {
    const resultat = flammeOrderedIds('aaa', 'bbb');
    expect(resultat).toEqual({ user1_id: 'aaa', user2_id: 'bbb' });
  });

  it('retourne user1_id < user2_id quand a > b (inversion correcte)', () => {
    const resultat = flammeOrderedIds('bbb', 'aaa');
    expect(resultat).toEqual({ user1_id: 'aaa', user2_id: 'bbb' });
  });

  it("respecte l'invariant user1_id < user2_id pour des UUIDs", () => {
    const idA = 'b3e7c100-0000-0000-0000-000000000000';
    const idB = 'a1f9d200-0000-0000-0000-000000000000';
    const { user1_id, user2_id } = flammeOrderedIds(idA, idB);
    expect(user1_id < user2_id).toBe(true);
  });

  it("respecte l'invariant user1_id < user2_id quel que soit l'ordre des arguments", () => {
    const idA = 'zzz-user';
    const idB = 'aaa-user';
    const { user1_id, user2_id } = flammeOrderedIds(idA, idB);
    expect(user1_id < user2_id).toBe(true);
    expect(user1_id).toBe('aaa-user');
    expect(user2_id).toBe('zzz-user');
  });

  it('convertit les arguments non-string en string avant comparaison', () => {
    // Les IDs sont toujours convertis via String()
    const resultat = flammeOrderedIds(1, 2);
    expect(resultat).toEqual({ user1_id: '1', user2_id: '2' });
  });

  it('gère le cas limite où a === b (IDs identiques)', () => {
    const resultat = flammeOrderedIds('same-id', 'same-id');
    // Quand a === b, x < y est false donc on renvoie { user1_id: y, user2_id: x }
    // Les deux valant 'same-id', la paire est valide même si peu probable en prod
    expect(resultat.user1_id).toBe('same-id');
    expect(resultat.user2_id).toBe('same-id');
  });

  it('produit le même résultat peu importe l\'ordre des arguments', () => {
    const idX = 'user-xyz-1';
    const idY = 'user-abc-9';
    const paire1 = flammeOrderedIds(idX, idY);
    const paire2 = flammeOrderedIds(idY, idX);
    expect(paire1).toEqual(paire2);
  });
});

// ---------------------------------------------------------------------------
// getLocalDayIsoRange
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
// fetchAcceptedFriendIds
// ---------------------------------------------------------------------------

describe('fetchAcceptedFriendIds', () => {
  const userId = 'user-courant-id';

  function creerSupabaseMock({ fd1 = [], fd2 = [], erreur1 = null, erreur2 = null } = {}) {
    const requeteChainee = (data, error) => ({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      then: undefined,
      // Dernière résolution
      _resolve: { data, error },
    });

    // On simule la chaîne fluent .from().select().eq().eq()
    const construireChaine = (data, error) => {
      const obj = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
      };
      // Convertir en promise
      const promise = Promise.resolve({ data, error });
      Object.setPrototypeOf(obj, promise);
      // On retourne directement une promesse qui résout avec les données
      return Promise.resolve({ data, error });
    };

    let appel = 0;
    const fromMock = jest.fn(() => ({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockImplementation(function () {
        // On accumule les appels eq, au 2ème on retourne la promise
        this._eqCount = (this._eqCount || 0) + 1;
        if (this._eqCount >= 2) {
          appel++;
          if (appel === 1) return Promise.resolve({ data: fd1, error: erreur1 });
          return Promise.resolve({ data: fd2, error: erreur2 });
        }
        return this;
      }),
    }));

    return { from: fromMock };
  }

  it('fusionne les IDs des deux directions (user_id et friend_id)', async () => {
    const supabaseMock = {
      from: jest.fn()
        .mockReturnValueOnce({
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          then: (resolve) => resolve({ data: [{ friend_id: 'ami-1' }, { friend_id: 'ami-2' }], error: null }),
        })
        .mockReturnValueOnce({
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          then: (resolve) => resolve({ data: [{ user_id: 'ami-3' }], error: null }),
        }),
    };

    // Approche directe : mock Promise.all
    const fd1 = [{ friend_id: 'ami-1' }, { friend_id: 'ami-2' }];
    const fd2 = [{ user_id: 'ami-3' }];

    const supabase = {
      from: jest.fn()
        .mockReturnValueOnce(creerChaineFluent({ data: fd1, error: null }))
        .mockReturnValueOnce(creerChaineFluent({ data: fd2, error: null })),
    };

    const ids = await fetchAcceptedFriendIds(supabase, userId);
    expect(ids).toEqual(expect.arrayContaining(['ami-1', 'ami-2', 'ami-3']));
    expect(ids).toHaveLength(3);
  });

  it('déduplique les IDs si un ami apparaît dans les deux sens', async () => {
    const fd1 = [{ friend_id: 'ami-doublon' }];
    const fd2 = [{ user_id: 'ami-doublon' }];

    const supabase = {
      from: jest.fn()
        .mockReturnValueOnce(creerChaineFluent({ data: fd1, error: null }))
        .mockReturnValueOnce(creerChaineFluent({ data: fd2, error: null })),
    };

    const ids = await fetchAcceptedFriendIds(supabase, userId);
    expect(ids).toHaveLength(1);
    expect(ids[0]).toBe('ami-doublon');
  });

  it('retourne un tableau vide si aucun ami', async () => {
    const supabase = {
      from: jest.fn()
        .mockReturnValueOnce(creerChaineFluent({ data: [], error: null }))
        .mockReturnValueOnce(creerChaineFluent({ data: [], error: null })),
    };

    const ids = await fetchAcceptedFriendIds(supabase, userId);
    expect(ids).toEqual([]);
  });

  it('lève une erreur si la première requête échoue', async () => {
    const erreurSupabase = new Error('Erreur réseau');
    const supabase = {
      from: jest.fn()
        .mockReturnValueOnce(creerChaineFluent({ data: null, error: erreurSupabase }))
        .mockReturnValueOnce(creerChaineFluent({ data: [], error: null })),
    };

    await expect(fetchAcceptedFriendIds(supabase, userId)).rejects.toThrow('Erreur réseau');
  });

  it('lève une erreur si la deuxième requête échoue', async () => {
    const erreurSupabase = new Error('Timeout');
    const supabase = {
      from: jest.fn()
        .mockReturnValueOnce(creerChaineFluent({ data: [], error: null }))
        .mockReturnValueOnce(creerChaineFluent({ data: null, error: erreurSupabase })),
    };

    await expect(fetchAcceptedFriendIds(supabase, userId)).rejects.toThrow('Timeout');
  });

  it('gère les données null (fd1 ou fd2 null) comme des tableaux vides', async () => {
    const supabase = {
      from: jest.fn()
        .mockReturnValueOnce(creerChaineFluent({ data: null, error: null }))
        .mockReturnValueOnce(creerChaineFluent({ data: null, error: null })),
    };

    const ids = await fetchAcceptedFriendIds(supabase, userId);
    expect(ids).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// hasSnapUsedTodayForPair
// ---------------------------------------------------------------------------

describe('hasSnapUsedTodayForPair', () => {
  const expediteurId = 'sender-123';
  const destinataireId = 'receiver-456';

  it('retourne true si count >= 1 (snap déjà envoyé aujourd\'hui)', async () => {
    const supabase = creerSupabaseSnapMock({ count: 1, error: null });
    const dejaUtilise = await hasSnapUsedTodayForPair(supabase, expediteurId, destinataireId);
    expect(dejaUtilise).toBe(true);
  });

  it('retourne true si count > 1 (plusieurs snaps)', async () => {
    const supabase = creerSupabaseSnapMock({ count: 3, error: null });
    const dejaUtilise = await hasSnapUsedTodayForPair(supabase, expediteurId, destinataireId);
    expect(dejaUtilise).toBe(true);
  });

  it('retourne false si count === 0 (aucun snap aujourd\'hui)', async () => {
    const supabase = creerSupabaseSnapMock({ count: 0, error: null });
    const dejaUtilise = await hasSnapUsedTodayForPair(supabase, expediteurId, destinataireId);
    expect(dejaUtilise).toBe(false);
  });

  it('retourne false si count est null (traité comme 0)', async () => {
    const supabase = creerSupabaseSnapMock({ count: null, error: null });
    const dejaUtilise = await hasSnapUsedTodayForPair(supabase, expediteurId, destinataireId);
    expect(dejaUtilise).toBe(false);
  });

  it('lève une erreur si Supabase retourne une erreur', async () => {
    const erreurSupabase = new Error('RLS violation');
    const supabase = creerSupabaseSnapMock({ count: null, error: erreurSupabase });
    await expect(hasSnapUsedTodayForPair(supabase, expediteurId, destinataireId)).rejects.toThrow('RLS violation');
  });

  it('interroge la table snaps avec les bons filtres sender_id et receiver_id', async () => {
    const eqMock = jest.fn().mockReturnThis();
    const supabase = {
      from: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: eqMock,
        gte: jest.fn().mockReturnThis(),
        lt: jest.fn().mockResolvedValue({ count: 0, error: null }),
      }),
    };

    await hasSnapUsedTodayForPair(supabase, expediteurId, destinataireId);

    expect(supabase.from).toHaveBeenCalledWith('snaps');
    expect(eqMock).toHaveBeenCalledWith('sender_id', expediteurId);
    expect(eqMock).toHaveBeenCalledWith('receiver_id', destinataireId);
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

    const avantAppel = new Date();
    avantAppel.setHours(0, 0, 0, 0);

    await hasSnapUsedTodayForPair(supabase, expediteurId, destinataireId);

    expect(gteMock).toHaveBeenCalledWith('created_at', expect.any(String));
    expect(ltMock).toHaveBeenCalledWith('created_at', expect.any(String));

    // Vérifier que les dates sont bien dans la plage du jour
    const [, startIso] = gteMock.mock.calls[0];
    const [, endIso] = ltMock.mock.calls[0];
    expect(new Date(startIso).getHours()).toBe(0);
    expect(new Date(endIso) - new Date(startIso)).toBe(24 * 60 * 60 * 1000);
  });
});

// ---------------------------------------------------------------------------
// Helpers pour les mocks Supabase (chaîne fluente)
// ---------------------------------------------------------------------------

/**
 * Crée un mock de chaîne fluente Supabase qui résout finalement avec { data, error }.
 * Couvre les appels : .from().select().eq().eq()... résolu en Promise.
 */
function creerChaineFluent({ data, error }) {
  const chainable = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    gte: jest.fn().mockReturnThis(),
    lt: jest.fn().mockReturnThis(),
    // Rendre l'objet thenable (promesse)
    then: (resolve, reject) => Promise.resolve({ data, error }).then(resolve, reject),
    catch: (reject) => Promise.resolve({ data, error }).catch(reject),
  };
  return chainable;
}

/**
 * Crée un mock Supabase pour hasSnapUsedTodayForPair qui retourne { count, error }.
 */
function creerSupabaseSnapMock({ count, error }) {
  return {
    from: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      gte: jest.fn().mockReturnThis(),
      lt: jest.fn().mockResolvedValue({ count, error }),
    }),
  };
}
