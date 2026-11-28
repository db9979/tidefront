// Deutsche Namen und Meldungen.

const NAMES: Record<string, string> = {
  kommandozentrale: "Kommandozentrale", stahlwerk: "Stahlwerk", raffinerie: "Raffinerie", chipfabrik: "Chipfabrik",
  versorgungshof: "Versorgungshof", kraftwerk: "Kraftwerk", windpark: "Windpark", solarfeld: "Solarfeld", speicherwerk: "Speicherwerk", lagerkomplex: "Lagerkomplex", tiefbunker: "Tiefbunker",
  werft: "Werft", kaserne: "Kaserne", flugfeld: "Flugfeld", radarstation: "Radarstation", hafenkommandantur: "Hafenkommandantur", forschungsamt: "Forschungsamt",
  korvette: "Korvette", zerstoerer: "Zerstörer", landungsschiff: "Landungsschiff", uboot: "U-Boot", schuetzen: "Schützen", pioniere: "Pioniere",
  kampfpanzer: "Kampfpanzer", abfangjaeger: "Abfangjäger", jagdbomber: "Jagdbomber", aufklaerungsdrohne: "Aufklärungsdrohne",
  schnellboot: "Schnellboot", piratenmiliz: "Piratenmiliz", flaggschiff: "Leviathan-Sektion", kuestenbatterie: "Küstenbatterie", flakstellung: "Flakstellung",
  bunkerlinie: "Bunkerlinie", minensperre: "Minensperre", anlagen: "Anlagen",
  stahl: "Stahl", treibstoff: "Treibstoff", elektronik: "Elektronik", proviant: "Proviant", credits: "Taler",
  ueberfall: "Überfall", aufklaerung: "Aufklärung", transport: "Transport", kartell: "Kartell-Überfall",
  luftkampf: "Luftkampf", luftschlag: "Luftschlag", ubootangriff: "U-Boot-Angriff", seegefecht: "Seegefecht", landung: "Landung",
  weltereignis: "Weltereignis", weltereignis_leer: "Weltereignis",
  nachrichtendienst: "Nachrichtendienst", spion: "Spion", spionage: "Spionage", sabotage: "Sabotage",
  erkunden: "Erkunden", desinformation: "Desinformation", bauschlange: "Bauschlange",
  anfaengerschutz: "Anfängerschutz", niederlage: "Schutz nach Niederlage", nachtschild: "Nachtschild", gruendungsschutz: "Gründungsschutz",
  sammelangriff: "Sammelangriff", stationierung: "Stationierung", // Allianz-Ops
  // See: Minen/Blockade/Konvoi
  minenleger: "Minenleger", minenraeumer: "Minenräumer", minen: "Minen legen", raeumen: "Minen räumen", blockade: "Blockade",
  abfangen: "Konvoi abfangen", geleit: "Geleitschutz", konvoi: "Konvoi", blockadekampf: "Blockadekampf", mine: "Minenfeld",
  // Felder: Rohstofffelder
  patrouille: "Patrouille", kampagne: "Aufklärungskampagne", radarposten: "Radarposten", sichtung: "Sichtung", posten: "Radarposten", // Lagebild Stufe 2
  besetzen: "Besetzen", admiral_heimkehr: "Admiral auf Heimfahrt", feld: "Rohstofffeld", oelfeld: "Ölfeld", erzbucht: "Erzbucht", fischgrund: "Fischgrund", elektronikwrack: "Elektronik-Wrack",
  // Mehrere Häfen
  kolonieschiff: "Kolonieschiff", gruendung: "Gründung", verlegung: "Verlegung", heimathafen: "Heimathafen", aussenposten: "Außenposten",
  // Ökostrom, Elektrolyse, Seekabel (v1.21)
  elektrolyse: "Elektrolyse", seekabel: "Seekabel",
  // Lagebild Stufe 3 (v1.23): Satelliten und Gegenmittel
  startrampe: "Startrampe", stoersender: "Störsender", satellit: "Satellit", optisch: "Optischer Satellit", radar: "Radarsatellit",
  raumfahrt: "Raumfahrt", tarnnetze: "Tarnnetze", optischer_satellit: "Optischer Satellit", radarsatellit: "Radarsatellit",
  // Weltereignisse (Kartell-Aufklärung: „Nächstes Unternehmen“)
  schatzschiff: "Schatzschiff", grossflotte: "Großflotte", belagerung: "Belagerung", finale: "Kartell-Armada",
};

/** Gibt es einen eigenen deutschen Namen (nicht nur den Rückfall von label())? Für Tests. */
export function hasLabel(id: string): boolean {
  return id in NAMES;
}

/** Gibt es einen Text für diesen Fehlercode? Für Tests. */
export function hasErrorText(code: string): boolean {
  return code in ERRORS || code === "rate";
}

const PLURAL: Record<string, string> = {
  korvette: "Korvetten", zerstoerer: "Zerstörer", landungsschiff: "Landungsschiffe", uboot: "U-Boote", schuetzen: "Schützen", pioniere: "Pioniere",
  kampfpanzer: "Kampfpanzer", abfangjaeger: "Abfangjäger", jagdbomber: "Jagdbomber", aufklaerungsdrohne: "Aufklärungsdrohnen",
  schnellboot: "Schnellboote", piratenmiliz: "Piratenmilizionäre", flaggschiff: "Leviathan-Sektionen", kuestenbatterie: "Küstenbatterien", flakstellung: "Flakstellungen",
  bunkerlinie: "Bunkerlinien", minensperre: "Minensperren", spion: "Spione", minenleger: "Minenleger", minenraeumer: "Minenräumer",
  kolonieschiff: "Kolonieschiffe",
};

/** Zahl mit passendem Wort, z. B. nOf(1, "Nest", "Nester") → „1 Nest“, nOf(1200, …) → „1.200 Nester“. */
export function nOf(n: number, one: string, many: string): string {
  return `${fmtNum(n)} ${n === 1 ? one : many}`;
}

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
  // Admirale
  admiral_off: "Admirale gibt es in dieser Saison nicht.",
  admiral_slots: "Alle Plätze für Admirale sind belegt. Mehr Plätze mit der Hafenkommandantur.",
  admiral_name: "Diesen Namen gibt es nicht in der Liste oder er ist schon vergeben.",
  admiral_spec: "Diese Spezialisierung ist nicht wählbar.",
  admiral_rank: "Die zweite Spezialisierung gibt es erst ab Vizeadmiral.",
  admiral_retrain_used: "Die kostenlose Umschulung ist für diesen Admiral schon verbraucht.",
  admiral_unknown: "Diesen Admiral gibt es nicht (mehr).",
  admiral_busy: "Der Admiral ist nicht bereit (unterwegs, verwundet oder gefangen).",
  admiral_not_captive: "Der Admiral ist nicht in Gefangenschaft.",
  admiral_funds: "Nicht genug Taler.",
  // Allianz-Ops: Sammelangriff und Stationierung
  station_not_ally: "Stationieren geht nur im Hafen eines Verbündeten (gleiche Allianz).",
  station_full: "In diesem Hafen liegen schon so viele verbündete Verbände wie erlaubt.",
  not_stationed: "Dieser Verband ist nicht stationiert.",
  no_raid: "Diesen Sammelangriff gibt es nicht (mehr).",
  raid_closed: "Die Beitrittsfrist ist vorbei.",
  raid_launched: "Die Verbände sind schon ausgelaufen – nur noch ein Rückruf ist möglich.",
  raid_other_alliance: "Dieser Sammelangriff gehört zu einer anderen Allianz.",
  raid_joined: "Du bist bei diesem Sammelangriff schon dabei.",
  raid_full: "Der Sammelangriff hat schon die Höchstzahl an Verbänden.",
  raid_limit: "Deine Allianz hat schon so viele offene Sammelangriffe wie erlaubt.",
  raid_bad_target: "Ein Sammelangriff braucht ein festes Ziel (Hafen, Nest, Großflotte oder Belagerung) – das Schatzschiff fährt.",
  not_joined: "Du bist bei diesem Sammelangriff nicht dabei.",
  bad_time: "Frist oder Ankunftszeit liegt außerhalb des erlaubten Rahmens.",
  bad_text: "Der Text fehlt oder ist zu lang.", // UX-0.43 B8: Erinnerung
  // Weltereignisse
  no_event: "Dieses Weltereignis gibt es nicht (mehr).",
  event_over: "Dieses Weltereignis ist schon vorbei.",
  event_needs_raid: "Gegen Weltereignisse ist nur ein Überfall möglich.",
  own_siege: "Aus dem belagerten Hafen selbst lässt sich der Ring nicht brechen – greife aus einem anderen deiner Häfen an oder bitte Mitspieler.",
  intercept_impossible: "Der Verband erreicht das Schatzschiff nicht mehr vor dem Hafen – schnellere Schiffe wählen.",
  too_late: "Der Verband käme erst nach dem Ende des Ereignisses an.",
  finale_not_yet: "Die Kartell-Armada ist bei Ankunft noch nicht erschienen. Lauf später aus.",
  finale_running: "Das Saisonfinale läuft bereits.",
  season_too_short: "Bis zum Saisonende bleibt keine Zeit mehr für das Finale.",
  siege: "Belagerungsring: keine Börsenkäufe, bis die Belagerung endet oder gebrochen ist.",
  already_claimed: "Diese Belohnung ist schon abgeholt.",
  not_done: "Das ist noch nicht erfüllt.",
  unknown_step: "Diesen Auftrag gibt es nicht.",
  no_season: "Gerade läuft keine Saison.",
  no_challenge: "Diesen Tagesbefehl gibt es nicht (mehr).",
  // Erfolge und Wochenziele
  no_goal: "Dieses Wochenziel gibt es nicht (mehr).",
  not_unlocked: "Diese Stufe ist noch nicht freigeschaltet.",
  reroll_used: "Heute wurde schon ein Befehl neu gewürfelt.",
  already_done: "Erfüllte Befehle lassen sich nicht neu würfeln.",
  no_alternative: "Gerade gibt es keinen anderen passenden Befehl.",
  bad_password: "Das bisherige Passwort stimmt nicht.",
  bad_reset: "Rücksetzcode oder Link ungültig, abgelaufen oder schon benutzt.",
  invite_exists: "Diesen Einladungscode gibt es schon.",
  bad_code: "Code: 3–64 Zeichen, nur Buchstaben, Ziffern, - und _.",
  no_player: "Spieler nicht gefunden.",
  bot_player: "KI-Spieler haben kein Passwort.",
  bot_limit: "Obergrenze der KI-Spieler erreicht (Einstellung in der Verwaltung).",
  bad_profile: "Unbekannte Spielweise.",
  no_bot: "KI-Spieler nicht gefunden.",
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
  building_level: "Dafür muss das Baugebäude weiter ausgebaut sein.",
  supply_shortage: "Versorgungsmangel: keine Ausbildung möglich.",
  no_aircraft_slots: "Keine freien Stellplätze auf dem Flugfeld.",
  troop_capacity: "Zu wenig Platz auf den Landungsschiffen.",
  command_points: "Der Verband kostet zu viele Kommandopunkte.",
  fuel: "Nicht genug Treibstoff.",
  storm: "Sturm am Hafen: Reine Luftmissionen starten nicht. Mit Schiffen auslaufen oder das Wetter abwarten.",
  out_of_range: "Ein Flugzeugtyp erreicht das Ziel nicht.",
  no_mission_slot: "Alle Missionsplätze sind belegt.",
  target_protected: "Das Ziel steht unter Schutz.",
  nest_empty: "Das Nest ist verlassen.",
  no_target: "Auf diesem Feld gibt es kein Ziel.",
  no_report: "Diesen Kampfbericht gibt es nicht (oder er ist kein Kampf zwischen Spielern).",
  own_base: "Das ist dein eigener Hafen.",
  transport_needs_base: "Transporte gehen nur an Häfen.",
  empty_fleet: "Keine Einheiten gewählt.",
  no_combat_units: "Keine Kampfeinheiten daheim.",
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
  not_finished: "Der Auftrag ist noch nicht fertig.",
  duplicate: "Dieser Befehl wurde schon ausgeführt.",
  bad_input: "Ungültige Eingabe. Bitte die Angaben prüfen.",
  unknown_nest_level: "Unbekannte Neststufe.",
  locked: "Börse und Spielerhandel öffnen ab Hafenkommandantur Stufe 3 (in einem deiner Häfen).",
  halted: "Handel mit dieser Ressource ist pausiert.",
  bad_qty: "Ungültige Menge.",
  impact: "Die Menge bewegt den Kurs zu stark. Kleinere Menge wählen.",
  rate: "Zu viele Geschäfte in kurzer Zeit.",
  daily_limit: "Tageslimit (24 h) für diese Ressource erreicht.",
  under_attack: "Ein Angriff ist im Anmarsch: Verkäufe gesperrt.",
  credit_limit: "Die Kasse wäre übervoll – mehr Taler fasst sie nicht.",
  funds: "Bestand oder Taler reichen nicht.",
  slippage: "Der Kurs hat sich bewegt. Bitte neu prüfen.",
  price_bounds: "Der Kurs würde die erlaubten Grenzen verlassen.",
  band: "Kursband verletzt: Handel für eine Weile pausiert.",
  invite_invalid: "Einladungscode ungültig, abgelaufen oder verbraucht.",
  invite_off: "Das Einladen von Freunden ist gerade abgeschaltet.",
  invite_open_limit: "Du hast schon die höchste Zahl offener Einladungen. Warte auf Antworten oder ziehe eine zurück.",
  invite_week_limit: "Für diese Woche hast du genug eingeladen. Bald geht es wieder.",
  invite_member: "Diese Adresse gehört schon einem Mitspieler – schreib ihm doch eine Nachricht.",
  invite_recent: "An diese Adresse ging in den letzten Tagen schon eine Einladung.",
  invite_blocked: "Diese Adresse möchte keine Einladungen zu TIDEFRONT erhalten.",
  invite_too_soon: "Erneut senden geht erst 24 Stunden nach dem letzten Versand.",
  invite_resend_max: "Diese Einladung wurde schon oft genug gesendet.",
  no_invite: "Diese Einladung gibt es nicht (mehr).",
  name_taken: "Der Name ist schon vergeben.",
  bad_login: "Name oder Passwort falsch.",
  not_coast: "Nur Küstenfelder sind erlaubt.",
  field_taken: "Das Feld ist schon belegt – oder jemand war schneller.",
  has_base: "Du hast schon einen Hafen.",
  no_base: "Dieser Hafen gehört dir nicht (mehr) – zurück zum Heimathafen.",
  rate_limited: "Zu viele Versuche. Bitte kurz warten.",
  network: "Keine Verbindung zum Server. Bitte erneut versuchen.",
  shield_cooldown: "Der Nachtschild lässt sich nur einmal je 24 Stunden umstellen.",
  shield_unchanged: "Diese Einstellung ist schon gewählt.",
  bad_hour: "Ungültige Startstunde.",
  bad_tz: "Ungültige Zeitzone.",
  template_limit: "Höchstens 20 Vorlagen. Bitte erst eine löschen.",
  // Allianzen, Diplomatie, Handel zwischen Spielern
  ally: "Das ist ein Hafen deiner Allianz.",
  pact: "Mit diesem Hafen besteht ein Nichtangriffspakt.",
  bad_name: "Name ungültig: Länge und erlaubte Zeichen prüfen.",
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
  bad_role: "Diese Rolle gibt es nicht.",
  no_recipient: "Diesen Spieler gibt es nicht.",
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
  // Lieferverträge (v1.31)
  no_contracts: "Lieferverträge gibt es in dieser Saison nicht.",
  no_ki: "Diesen KI-Spieler gibt es nicht (mehr) als Vertragspartner.",
  ki_refuses: "Dieser KI-Spieler schließt gerade nichts mit dir ab (nach deinem Überfall 72 Stunden lang, als Berüchtigter gar nicht).",
  // Weltpolitik (Gezeit, Seerat, Ansehen, Gesuche)
  ki_not_trusted: "Einen Nichtangriffspakt schließt dieser KI-Spieler erst, wenn dein Ansehen bei ihm „Vertraut“ ist.",
  no_gesuch: "Dieses Gesuch gibt es nicht.",
  gesuch_gone: "Dieses Gesuch ist nicht mehr offen.",
  no_session: "Diese Sitzung des Seerats gibt es nicht.",
  session_closed: "Die Abstimmung ist nicht offen.",
  bad_option: "Diese Wahl steht in der Sitzung nicht zur Abstimmung.",
  bot: "KI-Spieler stimmen im Seerat nicht einzeln ab.",
  seerat_off: "Der Seerat ist gerade ausgesetzt.",
  no_window: "Dieses Fenster gibt es nicht oder es ist schon vorbei.",
  not_offered: "Das bietet dieser KI-Spieler nicht an.",
  no_abo: "Dieser KI-Spieler bietet keine Abos an.",
  bad_term: "Diese Laufzeit geht nicht (Fälligkeit spätestens 24 Stunden vor Saisonende).",
  quota: "Das Kontingent des KI-Spielers reicht dafür nicht.",
  too_many_contracts: "Zu viele offene Verträge.",
  price_band: "Der Preis liegt außerhalb des erlaubten Bands um den Kurs.",
  pair_limit: "Zwischen euch beiden ist die Vertragsgrenze für diese Woche erreicht.",
  nothing: "Gerade ist nichts abholbereit.",
  storage_full: "Das Lager ist zu voll: Beim Abholen würde etwas verfallen. Erst Vorräte ausgeben oder den Lagerkomplex ausbauen.",
  contract_limit: "Vertragsgrenze erreicht: Vertragslieferungen dieser Ressource dürfen in 24 h nur einen Teil deines Tageslimits ausmachen. Kleinere Menge oder spätere Fälligkeit wählen.",
  not_for_you: "Dieses Vertragsangebot gilt nicht für dich.",
  contract_gone: "Diesen laufenden Vertrag gibt es nicht mehr.",
  offer_gone: "Das Angebot ist nicht mehr zu haben.",
  own_offer: "Das ist dein eigenes Angebot.",
  not_ally: "Dieses Angebot gilt nur für die Allianz des Anbieters.",
  seller_gone: "Der Anbieter hat keinen Hafen mehr.",
  unknown_tech: "Unbekannte Technik.",
  requires_tech: "Erst die Voraussetzung erforschen.",
  research_busy: "Es läuft schon eine Forschung.",
  breakthrough_pending: "Erst die Durchbruch-Belohnung wählen.",
  no_breakthrough: "Kein Durchbruch, der auf eine Wahl wartet.",
  already_chosen: "Die Belohnung ist schon gewählt.",
  bad_choice: "Ungültige Wahl.",
  no_research: "Forschung ist in dieser Saison nicht verfügbar.",
  // Nachrichtendienst
  covert_unit: "Spione fahren nicht in Verbänden mit – sie reisen nur mit Spionageaufträgen.",
  unit_cap: "Höchstzahl erreicht: der Nachrichtendienst führt je Stufe nur wenige Spione.",
  spy_level: "Dafür braucht der Nachrichtendienst eine höhere Stufe.",
  no_spies: "Nicht genug Spione daheim.",
  bad_sabotage_target: "Dieses Ziel lässt sich nicht sabotieren.",
  target_beginner: "Das Ziel steht unter Anfängerschutz – keine Spionage.",
  spy_target: "Spione arbeiten nur gegen Spielerhäfen.",
  sabotage_cooldown: "Dieser Hafen wurde vor Kurzem sabotiert und ist noch in Alarmbereitschaft (höchstens eine Sabotage je 24 Stunden).",
  // Seekabel (v1.21)
  cable_sabotage_war: "Ein Seekabel sabotierst du nur bei einem Kriegsgegner.",
  no_cable: "Seekabel gibt es in dieser Saison nicht.",
  cable_self: "Ein Seekabel verbindet zwei verschiedene Häfen.",
  cable_station_required: "Beide Häfen brauchen das Gebäude Seekabel (Stufe 1).",
  cable_busy: "Einer der Häfen hat schon ein Seekabel (oder eine offene Anfrage).",
  cable_too_far: "Die Häfen liegen zu weit auseinander für ein Seekabel.",
  cable_not_ally: "Seekabel zu fremden Häfen nur innerhalb der eigenen Allianz.",
  cable_price: "Ungültiger Preis für den Kabelstrom.",
  cable_gone: "Dieses Seekabel gibt es nicht mehr.",
  cable_not_party: "Das darf bei diesem Seekabel nur die andere Seite.",
  no_espionage: "Spionage ist in dieser Saison nicht verfügbar.",
  bad_spy_kind: "Unbekannte Auftragsart.",
  // See: Minen/Blockade/Konvoi
  not_sea: "Minen lassen sich nur auf offener See legen und räumen.",
  too_far: "Zu weit vom aktiven Hafen entfernt (Reichweite).",
  no_minelayer: "Zum Minenlegen gehört mindestens ein Minenleger in den Verband.",
  no_sweeper: "Zum Räumen gehört mindestens ein Minenräumer in den Verband.",
  too_many_fields: "Du hast schon die Höchstzahl an Minenfeldern ausgelegt.",
  blockade_ships_only: "Eine Blockade halten nur Schiffe – keine Truppen, keine Flugzeuge.",
  blockade_too_weak: "Zu schwach für eine Blockade: mehr bewaffnete Schiffe (Kommandopunkte) mitschicken.",
  already_blockading: "Du blockierst diesen Hafen schon.",
  no_blockade: "Diese Blockade gibt es nicht (mehr).",
  own_blockade: "Die eigene Blockade kannst du nur aufheben.",
  blockade: "Seeblockade: keine Börsenverkäufe, bis die Blockade endet oder gebrochen ist.",
  no_convoy: "Diesen Konvoi gibt es nicht (mehr).",
  own_convoy: "Eigene Konvois fängt man nicht ab.",
  convoy_not_enemy: "Nur Konvois von Kriegsgegnern lassen sich abfangen.",
  // Felder
  no_field: "Dieses Rohstofffeld gibt es nicht (mehr).",
  own_field: "Das Feld gehört dir schon.",
  field_limit: "Höchstzahl an Feldern erreicht – baue die Hafenkommandantur aus oder gib ein Feld auf.",
  field_ships_only: "Felder liegen auf See: nur Schiffe können sie besetzen.",
  garrison_too_weak: "Zu schwach für eine Besatzung: bewaffnete Schiffe mit genug Kommandopunkten mitschicken.",
  field_no_garrison: "Auf diesem Feld steht keine Besatzung mehr.",
  field_escort_invalid: "Das Geleit muss aus Schiffen der Besatzung bestehen (ganze Zahlen, höchstens ihr Bestand).",
  field_escort_too_large: "Zu viel Geleit: Der Rest muss als Besatzung bleiben (bewaffnet, genug Kommandopunkte).",
  no_fields: "Rohstofffelder sind in dieser Saison abgeschaltet.",
  intercept_needs_ships: "Zum Abfangen gehören Schiffe in den Verband.",
  escort_ships_only: "Geleitschutz stellen nur Schiffe.",
  escort_units: "So viele Schiffe hast du für das Geleit gerade nicht im Hafen.",
  escort_no_cargo: "Taler reisen nicht per Konvoi – Geleit gibt es nur für Ressourcen.",
  offer_escorted: "Der Anbieter stellt für diese Ware schon Geleit – eigenes Geleit ist hier nicht möglich.",
  field_has_admiral: "Die Besatzung dieses Felds hat schon einen Admiral.",
  field_no_admiral: "Diese Besatzung führt kein Admiral.",
  // Mehrere Häfen: Gründung und Verlegung
  expansion_off: "Gründen und Verlegen sind in dieser Saison noch nicht freigeschaltet.",
  base_limit: "Kein weiterer Hafen möglich: Höchstzahl erreicht oder die Kommandozentrale des Heimathafens ist noch zu klein.",
  too_close: "Zu nah an einem anderen Hafen. Wähle ein Küstenfeld mit mehr Abstand.",
  home_only: "Das geht nur im Heimathafen.",
  harbor_level: "Dafür muss die Hafenkommandantur weiter ausgebaut sein.",
  colony_ship: "Für die Gründung gehört genau ein Kolonieschiff in den Verband (Bau in der Werft ab Stufe 6).",
  transfer_needs_own_base: "Ziel muss einer deiner anderen Häfen sein.",
  command_level: "Die Kommandozentrale deines Heimathafens ist für einen weiteren Hafen noch zu klein.",
  trade_port: "Hier liegt ein Handelshafen – dort kann man nicht gründen.",
  resource_field: "Hier liegt ein Rohstofffeld – dort kann man nicht gründen.",
  too_close_own: "Zu nah an einem deiner eigenen Häfen.",
  same_base: "Ausgangs- und Zielhafen sind gleich.",
  admiral_elsewhere: "Dieser Admiral gehört zu einem anderen Hafen.",
  admiral_other_base: "Dieser Admiral dient in einem anderen Hafen – erst dorthin verlegen.",
  // Mehrere Häfen: umbenennen und Kolonie aufgeben
  bad_base_name: "Hafenname ungültig: 2–32 Zeichen, Buchstaben, Ziffern, Leerzeichen und _ . ' -.",
  base_name_taken: "Einer deiner Häfen trägt schon diesen Namen.",
  home_base: "Den Heimathafen kann man nicht aufgeben.",
  missions_out: "Von diesem Hafen sind noch Verbände unterwegs, gebunden oder stationiert – erst heimholen.",
  incoming_own: "Eine eigene Verlegung oder ein Transport ist auf dem Weg in diesen Hafen.",
  attack_incoming: "Ein Angriff auf diesen Hafen ist im Anmarsch.",
  guests_stationed: "Verbündete Verbände liegen in diesem Hafen oder sind auf dem Weg dorthin.",
  blockaded: "Der Hafen ist blockiert.",
  under_siege: "Der Hafen ist belagert.",
  deliveries_underway: "Lieferungen (Börse, Handel oder Feldertrag) sind auf dem Weg in diesen Hafen.",
  offers_open: "Aus diesem Hafen stehen noch Handelsangebote offen – erst zurückziehen.",
  field_held: "Ein Rohstofffeld liefert an diesen Hafen – erst aufgeben.",
  // Lagebild Stufe 2: Patrouille, Kampagne, Radarposten
  patrol_off: "Patrouillen gibt es in dieser Saison nicht.",
  patrol_units: "Auf Patrouille fahren nur Korvetten, Zerstörer, U-Boote und Aufklärungsdrohnen.",
  patrol_waypoints: "Eine Patrouille braucht 2 bis 4 Wegpunkte.",
  patrol_sea: "Wegpunkte müssen auf offener See liegen.",
  patrol_hours: "Dauer 4, 8 oder 12 Stunden wählen.",
  patrol_drone_hours: "Drohnen fliegen höchstens 6 Stunden – mit Drohnen nur 4 Stunden Patrouille.",
  patrol_drone_range: "Ein Wegpunkt liegt außerhalb der Drohnenreichweite (800 km vom Hafen).",
  campaign_off: "Aufklärungskampagnen gibt es in dieser Saison nicht.",
  campaign_targets: "Eine Kampagne hat 1 bis 4 verschiedene Ziele.",
  post_off: "Radarposten gibt es in dieser Saison nicht.",
  post_crew: "Ein Radarposten braucht mindestens 5 Pioniere und ein Landungsschiff.",
  post_radar: "Radarposten errichtet nur ein Hafen mit Radarstation Stufe 3.",
  post_site: "Hier kann kein Radarposten stehen: nur auf freier Küste oder einem eigenen Rohstofffeld.",
  post_limit: "Höchstzahl Radarposten erreicht.",
  post_too_close: "Zu nah an einem eigenen Radarposten (mindestens 300 km Abstand).",
  no_post: "Diesen Radarposten gibt es nicht mehr.",
  own_post: "Das ist dein eigener Radarposten.",
  // Lagebild Stufe 3: Satelliten, Voraussetzungen von Gebäuden
  building_requires: "Dafür fehlen Voraussetzungen (andere Gebäude dieses Hafens).",
  sat_off: "Satelliten gibt es in dieser Saison nicht.",
  sat_type: "Diese Satellitenart gibt es nicht.",
  sat_pad: "Satelliten starten nur von einer Startrampe.",
  sat_tech: "Diese Satellitenart ist noch nicht erforscht (Zweig Raumfahrt).",
  sat_limit: "Höchstzahl Satelliten erreicht – erst wenn einer verglüht, startet der nächste.",
  // Verwaltung (sonst meist mit eigenem Text an Ort und Stelle)
  not_failed: "Das Ereignis ist nicht mehr fehlgeschlagen.",
  already_pending: "Für dasselbe Objekt ist bereits ein Ereignis dieses Typs offen.",
  bad_screenshot: "Der Screenshot ist zu groß oder beschädigt.",
  no_file: "Die Sicherung ist nicht mehr vorhanden.",
};

export function errorText(code: string): string {
  if (code === "rate") return "Zu viele Versuche. Bitte kurz warten.";
  return ERRORS[code] ?? `Abgelehnt (${code}).`;
}

/**
 * Text für eine Ausnahme bei einem Serveraufruf: Eingabefehler (HTTP 400) mit der Erklärung des Servers,
 * sonst passende Meldungen für Anmeldung, Drosselung und fehlende Verbindung.
 */
export function failText(err: unknown): string {
  const data = (err as { data?: { code?: string; inputError?: string | null } | null } | null)?.data;
  if ((err as { message?: unknown } | null)?.message === "no_base") return errorText("no_base"); // Mehrere Häfen
  switch (data?.code) {
    case "BAD_REQUEST": return data.inputError ?? "Ungültige Eingabe. Bitte die Angaben prüfen.";
    case "TOO_MANY_REQUESTS": return errorText("rate");
    case "UNAUTHORIZED": return "Nicht mehr angemeldet. Bitte neu anmelden.";
    case "FORBIDDEN": return "Dafür fehlt die Berechtigung.";
    case "PAYLOAD_TOO_LARGE": return "Die Eingabe ist zu lang.";
    default: return errorText("network");
  }
}

/** War der Fehler ein abgelehnter Aufruf (Eingabe, Rechte) statt eines Netzfehlers? */
export function isRejected(err: unknown): boolean {
  const code = (err as { data?: { code?: string } | null } | null)?.data?.code;
  return typeof code === "string" && code !== "INTERNAL_SERVER_ERROR";
}

export function fmtNum(n: number, digits = 0): string {
  return n.toLocaleString("de-DE", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}
