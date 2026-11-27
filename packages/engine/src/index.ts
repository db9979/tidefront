export * from "./context.ts";
export * from "./events.ts";
export * from "./commands.ts";
export * from "./views.ts";
export * from "./auth.ts";
export * from "./audit.ts";
export * from "./seed.ts";
export * from "./scoring.ts";
export * from "./season.ts";
export * from "./cartel-strength.ts";
export * from "./season-alliances.ts";
export * from "./social.ts";
export { baseOfPlayer, basesOfPlayer, homeBaseOf, lockOwnBase, ownBase, type BaseRow } from "./store.ts";
export * from "./expansion.ts"; // Mehrere Häfen
export { abandonBlockers, abandonColony, abandonInfo, renameBase } from "./harbors.ts"; // Mehrere Häfen: verwalten
export { BASE_NAME_RE, colonyNameAt, normalizeBaseName } from "./harbor-names.ts";
export * from "./account.ts";
export * from "./ops.ts";
export * from "./push.ts";
export * from "./mail.ts";
export * from "./mail-templates.ts";
// Ausführliche E-Mails: je Berichtsart ein Abschnitt (registerReportSection), Standard für unbekannte Arten
export { genericBlocks, registerReportSection, reportMailFor, reportMailParts, type ReportMailParts, type ReportSection, type ReportView } from "./mail-reports.ts";
export { attackWarningMail, defaultNoticeBlocks, digestBlocks } from "./mail-notices.ts";
export * from "./notices.ts";
export * from "./settings.ts";
export * from "./invite.ts";
export { inviteMail } from "./invite-mail.ts";
export { scheduleAttackWarning } from "./event-notices.ts";
export * from "./daily.ts";
export { trackProgress, challengePoints, ensureAssigned, refreshDerivedOpen } from "./challenges.ts";
export { dayKey, dayStartMs, nextDayStartMs, addDays, KINDS as CHALLENGE_KINDS, drawDay, poolContext, streakBonus } from "./challenge-pool.ts";
export * from "./backups.ts";
export * from "./adminstats.ts";
export * from "./comfort.ts";
export * from "./summary.ts";
// Allianzen, Diplomatie, Handel zwischen Spielern
export {
  ALLIANCE_MAX_DEFAULT, atWar, CHAT_MAX, DESCRIPTION_MAX, diplomacyBlock, membershipOf, PACT_NOTICE_MS, partyOf, ROLES, WAR_LEAD_MS, type Role,
} from "./alliance-core.ts";
export * from "./alliance.ts";
export * from "./alliance-view.ts";
export * from "./diplomacy.ts";
export * from "./player-trade.ts";
export * from "./player-trade-stats.ts";
export * from "./input-errors.ts";
export { dailySummarySection } from "./daily-summary.ts";
export { ensureWorldEventPlanner, siegeEffects, clearWorldEvents } from "./world-events.ts";
export { spawnWorldEvent } from "./world-events-spawn.ts";
export { worldEventsView } from "./world-events-view.ts";
export {
  clearMarketNews, effectiveMarketRefs, marketNewsAdmin, marketNewsView, marketRefs, pctText, upsertNews, REF_OFFSETS_KEY, SCARCITY_KEY,
} from "./market-news.ts";
export { runMarketNews, runMarketNewsTx, scarcityInput, warSituation, worldEventNews, worldEventSpecs } from "./market-news-sources.ts";
export * from "./modifiers.ts";
export * from "./battle-stats.ts";
export { veteranView, withAttackExperience, type VeteranInfo } from "./veterans.ts";
export { researchStart, researchCancel, researchChoose, researchView, TECH_NAMES } from "./research.ts";
export { guideView, claimGuideStep, claimGuideFinal, hafenmeisterIds, shortenQueue, deliverToStorage, GUIDE_STEPS, GUIDE_FINAL, GUIDE_GOALS } from "./guide.ts";
export { ensureStartNest, nearestOpenLevel1, reachableShoreSea, START_NEST_KM } from "./start-nest.ts"; // Einstieg
export { spyPreview, spyLaunch, intelView, intelOwnView, type SpyInput } from "./espionage.ts";
export { gridView, weatherModifiers, missionWeather, battleWeather } from "./weather.ts";
export * from "./bug-report.ts";
export { appointAdmiral, chooseAdmiralSpec, stationAdmiral, ransomAdmiral, dismissAdmiral, admiralView, admiralSpecIds, type AdmiralInfo } from "./admirals.ts"; // Admirale
// Erfolge (Abzeichen) und Wochenziele; recordAchievement ist die Erweiterungsstelle für neue Ereignisse.
export { recordAchievement, flushAchievementNotices, topBadges, type RecordOptions } from "./achievements.ts";
export { achievementsView, claimAchievement, weeklyView, claimWeekly } from "./achievements-view.ts";
export {
  achievementList, drawWeek, nextWeekStartMs, placementScore, tierFor, weekKey, weekStartMs, weeklyBonus, weeklyReward, WEEKLY_KINDS,
} from "./achievement-defs.ts";
// Allianz-Ops: Sammelangriff und Stationierung
export { openRaid, joinRaid, withdrawRaid, cancelRaid } from "./alliance-ops-raid.ts";
export { stationRelease, STATION_TYPE } from "./alliance-ops-station.ts";
export { allianceRaidsView } from "./alliance-ops-view.ts";
// See: Minen, Blockade und Konvois
export { navalView, navalRouteMines, liftBlockade, clearNaval, NAVAL_TYPES } from "./naval.ts";
// Felder: Rohstofffelder einnehmen
export { fieldsView, spawnFields, FIELD_KIND_TEXT } from "./fields-core.ts";
export { fieldRecall } from "./fields-missions.ts";
export { fieldAdmiralRecall } from "./fields-admiral.ts"; // Felder: Admiral ohne Rückruf abziehen
export { setFieldEscort } from "./fields-escort.ts";
export { ensureFieldPlanner, clearFields } from "./fields-run.ts";
// KI-Spieler (Bots)
export {
  addBot, ensureStartBots, updateBot, removeBotStep, setBotsServer, botsEnabled, botsMax, loadBots, loadBot, BOT_PROFILES, PROFILE_TEXT,
  isActiveTime, nextTurnAt, type BotProfile, type BotRow, type BotSettings, type BotState,
} from "./bots-core.ts";
export { botTurn, runBotsDue, runOneBot } from "./bots-run.ts";
export { botsAdminView } from "./bots-admin.ts";
export { isBot, botIds } from "./bots-flag.ts";
export { ensureNests } from "./nest-sites.ts"; // Nestplätze nachtragen (Stufe 6, v1.15)
// Lagebild: Sicht je Spieler/Allianz, gespeichertes Wissen, Server-Einstellung intel_fog
export { intelFogOn, setIntelFog, sightOf, clearSightCache, INTEL_FOG_SETTING, type Sight, type Sensor } from "./intel-sight.ts";
export { purgeIntel, knownFor, recordSightings, clearPersistThrottle, type IntelTag } from "./intel-store.ts";
export { mapViewFor, fleetPosition } from "./intel-map.ts";
export { nestKnown } from "./intel-query.ts";
// Seekabel / Stromverbund (v1.21)
export { cableOffer, cableAccept, cableSetPrice, cableCut, CABLE_TICK } from "./power-cable.ts";
export { cablesView } from "./power-cable-view.ts";
// Lagebild Stufe 2: Patrouille, Aufklärungskampagne, Radarposten, Übersicht „Lagebild“
export { launchIntelOp, previewIntelOp, endPatrol, type IntelOp, type IntelOpInput } from "./intel-ops.ts";
export { dismantlePost } from "./intel-post.ts";
export { intelOverview } from "./intel-overview.ts";
export { launchSatellite, MAP_WIDTH_KM, stripPlace } from "./intel-sat.ts"; // Lagebild Stufe 3: Satelliten
export { counterWorld, clearCounterCache } from "./intel-counter.ts"; // Lagebild Stufe 3: Gegenmittel
// Spielerbindung und Admin-Kennzahlen (Erinnerungen, Rückhol-E-Mail, Aktivität, Meilensteine, Laufzeiten)
export { claimNudge, cleanupNudges, hasNudge, milestoneKeys, recordActivity, recordMilestones } from "./activity.ts";
export * from "./retention.ts";
export * from "./winback.ts";
export * from "./admin-kpi.ts";
export * from "./rpc-timing.ts";
export { runEventWatchdog, REPAIR_GIVE_UP, type WatchdogResult } from "./event-watchdog.ts"; // Wächter der Ereignis-Queue
export { listFailedEvents, requeueEvent, type FailedEvent } from "./event-admin.ts"; // Verwaltung → Ereignisse
export { lockPlayerWide, worldLockExclusive, worldLockShared } from "./world-lock.ts";
export { bumpMapGeneration, enableMapCache } from "./map-cache.ts"; // world.map: geteilte Weltdaten zwischenspeichern
export { rankSnapshot, clearRankSnapshot, colluded, bountyByPlayer, type RankSnapshot } from "./pvp.ts"; // Spieler gegen Spieler
export { recordTies } from "./pvp-ties.ts";
export { pvpTargetView, suspiciousPairs, setReportExcluded } from "./pvp-view.ts";
