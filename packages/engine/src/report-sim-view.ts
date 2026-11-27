// Bericht → Kampfsimulator (Serverseite): Die Kampfbedingungen im Bericht (battle.setup) enthalten die Modifikatoren
// beider Seiten. Ist der Gegner des Lesers ein Spieler, bleiben dessen Forschung/Admiral geheim: report.get liefert
// sie nicht aus (modifiersHidden), der Simulator rechnet für ihn neutral.
type Obj = Record<string, unknown>;

export function opponentIsPlayer(r: { attackerPlayerId: number | null; defenderPlayerId: number | null }, role: string, playerId: number): boolean {
  const opp = role === "defender" ? r.attackerPlayerId : r.defenderPlayerId;
  return opp !== null && opp !== playerId;
}

export function hideOpponentSetup(data: Obj, role: string, oppIsPlayer: boolean): Obj {
  const battle = data.battle as Obj | undefined;
  const setup = battle?.setup as Record<"attacker" | "defender", Obj | undefined> | undefined;
  if (!oppIsPlayer || !battle || !setup) return data;
  const opp = role === "defender" ? "attacker" : "defender";
  const side = setup[opp];
  if (!side?.modifiers) return data;
  const { modifiers: _hidden, ...rest } = side;
  return { ...data, battle: { ...battle, setup: { ...setup, [opp]: { ...rest, modifiersHidden: true } } } };
}
