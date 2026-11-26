// Deutsche Namen und Meldungen.

const NAMES: Record<string, string> = {
  kommandozentrale: "Kommandozentrale", stahlwerk: "Stahlwerk", raffinerie: "Raffinerie", chipfabrik: "Chipfabrik",
  versorgungshof: "Versorgungshof", kraftwerk: "Kraftwerk", lagerkomplex: "Lagerkomplex", tiefbunker: "Tiefbunker",
  werft: "Werft", kaserne: "Kaserne", flugfeld: "Flugfeld", radarstation: "Radarstation", hafenkommandantur: "Hafenkommandantur",
  korvette: "Korvette", zerstoerer: "Zerstörer", landungsschiff: "Landungsschiff", schuetzen: "Schützen", pioniere: "Pioniere",
  kampfpanzer: "Kampfpanzer", abfangjaeger: "Abfangjäger", jagdbomber: "Jagdbomber", aufklaerungsdrohne: "Aufklärungsdrohne",
  schnellboot: "Schnellboot", piratenmiliz: "Piratenmiliz", kuestenbatterie: "Küstenbatterie", flakstellung: "Flakstellung",
  bunkerlinie: "Bunkerlinie", minensperre: "Minensperre", anlagen: "Anlagen",
  stahl: "Stahl", treibstoff: "Treibstoff", elektronik: "Elektronik", proviant: "Proviant", credits: "Kredite",
  ueberfall: "Überfall", aufklaerung: "Aufklärung", transport: "Transport", kartell: "Kartell-Überfall",
  luftkampf: "Luftkampf", luftschlag: "Luftschlag", seegefecht: "Seegefecht", landung: "Landung",
  anfaengerschutz: "Anfängerschutz", niederlage: "Schutz nach Niederlage", nachtschild: "Nachtschild",
};

const PLURAL: Record<string, string> = {
  korvette: "Korvetten", zerstoerer: "Zerstörer", landungsschiff: "Landungsschiffe", schuetzen: "Schützen", pioniere: "Pioniere",
  kampfpanzer: "Kampfpanzer", abfangjaeger: "Abfangjäger", jagdbomber: "Jagdbomber", aufklaerungsdrohne: "Aufklärungsdrohnen",
  schnellboot: "Schnellboote", piratenmiliz: "Piratenmilizionäre", kuestenbatterie: "Küstenbatterien", flakstellung: "Flakstellungen",
  bunkerlinie: "Bunkerlinien", minensperre: "Minensperren",
};

/** Name mit passender Zahlform für eine Menge. */
export function countLabel(id: string, n: number): string {
  return n === 1 ? label(id) : PLURAL[id] ?? label(id);
}

/** Name aus einer ID; unbekannte IDs werden lesbar gemacht (ae → ä usw.). */
export function label(id: string): string {
  if (NAMES[id]) return NAMES[id];
  const s = id.replace(/ae/g, "ä").replace(/oe/g, "ö").replace(/ue/g, "ü").replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export const RES_ICON: Record<string, string> = { stahl: "⛓", treibstoff: "🛢", elektronik: "🔌", proviant: "🥫" };

const ERRORS: Record<string, string> = {
  bad_password: "Das bisherige Passwort stimmt nicht.",
  bad_reset: "Rücksetzcode oder Link ungültig, abgelaufen oder schon benutzt.",
  invite_exists: "Diesen Einladungscode gibt es schon.",
  bad_code: "Code: 3–64 Zeichen, nur Buchstaben, Ziffern, - und _.",
  no_player: "Spieler nicht gefunden.",
  bad_email: "Bitte eine gültige E-Mail-Adresse eingeben.",
  mail_off: "Der E-Mail-Versand ist auf diesem Server nicht eingerichtet.",
  no_secret: "APP_SECRET fehlt auf dem Server; E-Mail ist abgeschaltet.",
  no_email: "Keine eigene E-Mail-Adresse hinterlegt.",
  mail_failed: "Versand fehlgeschlagen.",
  push_none: "Keine Benachrichtigung zugestellt.",
  bad_endpoint: "Ungültiges Push-Abo.",
  insufficient_resources: "Nicht genug Ressourcen.",
  queue_full: "Die Bauschlange ist voll.",
  no_mission: "Diese Mission gibt es nicht (mehr).",
  not_outbound: "Der Verband ist schon auf der Rückfahrt.",
  already_recalled: "Der Verband wurde schon zurückgerufen.",
  already_arrived: "Der Verband ist schon am Ziel angekommen.",
  queue_busy: "Dieses Gebäude bildet schon aus.",
  max_level: "Höchststufe erreicht.",
  command_cap: "Erst die Kommandozentrale ausbauen.",
  building_required: "Dafür fehlt das passende Gebäude.",
  supply_shortage: "Versorgungsmangel: keine Ausbildung möglich.",
  no_aircraft_slots: "Keine freien Stellplätze auf dem Flugfeld.",
  troop_capacity: "Zu wenig Platz auf den Landungsschiffen.",
  command_points: "Der Verband kostet zu viele Kommandopunkte.",
  fuel: "Nicht genug Treibstoff.",
  out_of_range: "Ein Flugzeugtyp erreicht das Ziel nicht.",
  no_mission_slot: "Alle Missionsplätze sind belegt.",
  target_protected: "Das Ziel steht unter Schutz.",
  nest_empty: "Das Nest ist verlassen.",
  no_target: "Auf diesem Feld gibt es kein Ziel.",
  own_base: "Das ist der eigene Stützpunkt.",
  transport_needs_base: "Transporte gehen nur an Stützpunkte.",
  empty_fleet: "Keine Einheiten gewählt.",
  units_unavailable: "So viele Einheiten sind nicht daheim.",
  no_carrier: "Der Verband braucht Schiffe oder Flugzeuge.",
  cargo_capacity: "Die Ladung übersteigt die Ladekapazität.",
  cargo_not_allowed: "Ladung nur beim Transport.",
  bad_cargo: "Ungültige Ladung.",
  bad_type: "Unbekannter Missionstyp.",
  bad_count: "Ungültige Anzahl.",
  unknown_unit: "Unbekannte Einheit.",
  unknown_building: "Unbekanntes Gebäude.",
  no_order: "Kein laufender Auftrag.",
  already_finished: "Der Auftrag ist schon fertig.",
  locked: "Die Börse öffnet ab Hafenkommandantur Stufe 3.",
  halted: "Handel mit dieser Ressource ist pausiert.",
  bad_qty: "Ungültige Menge.",
  impact: "Die Menge bewegt den Kurs zu stark. Kleinere Menge wählen.",
  rate: "Zu viele Geschäfte in kurzer Zeit.",
  daily_limit: "Tageslimit für diese Ressource erreicht.",
  under_attack: "Ein Angriff ist im Anmarsch: Verkäufe gesperrt.",
  credit_limit: "Das Kreditlimit wäre überschritten.",
  funds: "Bestand oder Kredite reichen nicht.",
  slippage: "Der Kurs hat sich bewegt. Bitte neu prüfen.",
  price_bounds: "Der Kurs würde die erlaubten Grenzen verlassen.",
  band: "Kursband verletzt: Handel für eine Weile pausiert.",
  invite_invalid: "Einladungscode ungültig oder verbraucht.",
  name_taken: "Der Name ist schon vergeben.",
  bad_login: "Name oder Passwort falsch.",
  not_coast: "Nur Küstenfelder sind erlaubt.",
  field_taken: "Das Feld ist schon belegt.",
  has_base: "Du hast schon einen Stützpunkt.",
  no_base: "Noch kein Stützpunkt.",
  rate_limited: "Zu viele Versuche. Bitte kurz warten.",
  network: "Keine Verbindung zum Server. Bitte erneut versuchen.",
  // Allianzen, Diplomatie, Handel zwischen Spielern
  ally: "Das ist ein Hafen deiner Allianz.",
  pact: "Mit diesem Hafen besteht ein Nichtangriffspakt.",
  bad_name: "Name: 3–32 Zeichen, Buchstaben, Ziffern, Leerzeichen und . _ - '.",
  bad_tag: "Kürzel: 2–4 Buchstaben oder Ziffern.",
  tag_taken: "Das Kürzel ist schon vergeben.",
  in_alliance: "Du gehörst schon einer Allianz an.",
  no_alliance: "Du gehörst keiner Allianz an.",
  no_rights: "Dazu fehlt dir die Berechtigung.",
  alliance_full: "Die Allianz ist voll.",
  target_in_alliance: "Dieser Spieler gehört schon einer Allianz an.",
  already_invited: "Dieser Spieler ist schon eingeladen.",
  already_requested: "Du hast schon angefragt.",
  no_request: "Diese Einladung oder Anfrage gibt es nicht mehr.",
  not_member: "Dieser Spieler ist kein Mitglied.",
  self: "Das geht nicht mit dir selbst.",
  empty: "Der Text ist leer.",
  bad_target: "Unbekanntes Gegenüber.",
  at_war: "Ihr seid im Krieg. Erst Frieden schließen.",
  pact_exists: "Der Pakt besteht schon.",
  pact_active: "Erst den Pakt kündigen und die Frist abwarten.",
  already_offered: "Das Angebot liegt schon vor.",
  already_cancelled: "Der Pakt ist schon gekündigt.",
  already_war: "Der Krieg ist schon erklärt.",
  no_treaty: "Diesen Vertrag gibt es nicht mehr.",
  bad_offer: "Ungültiges Angebot.",
  too_many_offers: "Zu viele offene Angebote.",
  offer_gone: "Das Angebot ist nicht mehr zu haben.",
  own_offer: "Das ist dein eigenes Angebot.",
  not_ally: "Dieses Angebot gilt nur für die Allianz des Anbieters.",
  seller_gone: "Der Anbieter hat keinen Hafen mehr.",
};

export function errorText(code: string): string {
  if (code === "rate") return "Zu viele Versuche. Bitte kurz warten.";
  return ERRORS[code] ?? `Abgelehnt (${code}).`;
}

export function fmtNum(n: number, digits = 0): string {
  return n.toLocaleString("de-DE", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}
