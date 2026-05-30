/** Paires flammes en base : user1_id < user2_id (contrainte SQL). */
export function flammeOrderedIds(a, b) {
  const x = String(a);
  const y = String(b);
  return x < y ? { user1_id: x, user2_id: y } : { user1_id: y, user2_id: x };
}

/** Fenêtre jour local [minuit, lendemain minuit[. */
export function getLocalDayIsoRange() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

export async function fetchAcceptedFriendIds(supabase, userId) {
  const [{ data: fd1, error: e1 }, { data: fd2, error: e2 }] = await Promise.all([
    supabase
      .from('friendships')
      .select('friend_id')
      .eq('user_id', userId)
      .eq('status', 'accepted'),
    supabase
      .from('friendships')
      .select('user_id')
      .eq('friend_id', userId)
      .eq('status', 'accepted'),
  ]);
  if (e1 || e2) throw e1 || e2;
  return [
    ...new Set([
      ...(fd1 || []).map((r) => r.friend_id),
      ...(fd2 || []).map((r) => r.user_id),
    ]),
  ];
}

/** true si un snap a déjà été envoyé aujourd’hui (fuseau local) pour cette paire. */
export async function hasSnapUsedTodayForPair(supabase, senderId, receiverId) {
  const { startIso, endIso } = getLocalDayIsoRange();
  const { count, error } = await supabase
    .from('snaps')
    .select('*', { count: 'exact', head: true })
    .eq('sender_id', senderId)
    .eq('receiver_id', receiverId)
    .gte('created_at', startIso)
    .lt('created_at', endIso);
  if (error) throw error;
  return (count ?? 0) >= 1;
}
