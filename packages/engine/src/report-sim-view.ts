// Bericht → Kampfsimulator (Serverseite): Die Kampfbedingungen im Bericht (battle.setup) enthalten die Modifikatoren
// beider Seiten. Ist der Gegner des Lesers ein Spieler, bleiben dessen Forschung/Admiral/Veteranen geheim – für beide
// Seiten („Boni beidseitig geheim“): report.get liefert sie nicht aus (setup: modifiersHidden; die Eingaben des
// Angreifers unter data.attacker ohne modifiers), der Simulator rechnet für ihn neutral. Eigene Werte bleiben.
type Obj = Record<string, unknown>;

export function opponentIsPlayer(r: { attackerPlayerId: number | null; defenderPlayerId: number | null }, role: string, playerId: number): boolean {
  const opp = role === "defender" ? r.attackerPlayerId : r.defenderPlayerId;
  return opp !== null && opp !== playerId;
}

export function hideOpponentSetup(data: Obj, role: string, oppIsPlayer: boolean): Obj {
  if (!oppIsPlayer) return data;
  const opp = role === "defender" ? "attacker" : "defender";
  let out = data;
  // Ältere und neue Berichte: Eingaben des Angreifers (AttackerInput) liegen auch unter data.attacker.
  const input = data.attacker as Obj | undefined;
  if (opp === "attacker" && input && typeof input === "object" && "modifiers" in input) {
    const { modifiers: _hidden, ...rest } = input;
    out = { ...out, attacker: rest };
  }
  const battle = out.battle as Obj | undefined;
  const setup = battle?.setup as Record<"attacker" | "defender", Obj | undefined> | undefined;
  const side = setup?.[opp];
  if (!battle || !setup || !side?.modifiers) return out;
  const { modifiers: _hidden, ...rest } = side;
  return { ...out, battle: { ...battle, setup: { ...setup, [opp]: { ...rest, modifiersHidden: true } } } };
}
