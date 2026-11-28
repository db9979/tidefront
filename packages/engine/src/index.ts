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
export { genericBlocks, isSimulable, registerReportSection, reportMailFor, reportMailParts, reportViewFor, type ReportMailParts, type ReportSection, type ReportView } from "./mail-reports.ts";
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
export { startFinaleNow, ensureFinalePlanner } from "./finale-run.ts"; // Saisonfinale
export { finaleParticipants, finaleCenter, finaleVanguards } from "./finale-core.ts";
export { finaleAim } from "./finale-battle.ts";
export {
  clearMarketNews, effectiveMarketRefs, marketNewsAdmin, marketNewsView, marketRefs, pctText, pruneMarketNews, upsertNews, REF_OFFSETS_KEY, SCARCITY_KEY,
} from "./market-news.ts";
export {
  activePortCount, netBuysByPlayer, runMarketNews, runMarketNewsTx, scarcityInput, warSituation, worldEventNews, worldEventSpecs,
} from "./market-news-sources.ts";
export { marketChartView, recordMarketCloses } from "./market-history.ts"; // Saisonchart der Börse
export * from "./modifiers.ts";
export * from "./battle-stats.ts";
export { veteranView, withAttackExperience, type VeteranInfo } from "./veterans.ts";
export { researchStart, researchCancel, researchChoose, researchView, TECH_NAMES } from "./research.ts";
export { guideView, claimGuideStep, claimGuideFinal, hafenmeisterIds, shortenQueue, deliverToStorage, GUIDE_STEPS, GUIDE_FINAL, GUIDE_GOALS } from "./guide.ts";
export { ensureStartNest, nearestOpenLevel1, reachableShoreSea, START_NEST_KM } from "./start-nest.ts"; // Einstieg
export { spyPreview, spyLaunch, intelView, intelOwnView, type SpyInput } from "./espionage.ts";
export { gridView, weatherModifiers, missionWeather, battleWeather } from "./weather.ts";
export * from "./bug-report.ts";
export { appointAdmiral, chooseAdmiralSpec, retrainAdmiral, stationAdmiral, ransomAdmiral, dismissAdmiral, admiralView, admiralSpecIds, type AdmiralInfo } from "./admirals.ts"; // Admirale
// Erfolge (Abzeichen) und Wochenziele; recordAchievement ist die Erweiterungsstelle für neue Ereignisse.
export { recordAchievement, recordTradeFee, flushAchievementNotices, topBadges, type RecordOptions } from "./achievements.ts";
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
export * from "./catch-up.ts"; // Aufholhilfe: Baugutschrift (stündlicher Lauf, Startpaket)
// Lieferverträge (v1.31): KI-Verträge, Verträge zwischen Spielern, Kündigung, Reiter „Verträge“
export { kiContractQuote, signKiContract } from "./contracts-sign.ts";
export { acceptPlayerContract, proposePlayerContract, withdrawPlayerContract } from "./contracts-player.ts";
export { cancelContract } from "./contracts-cancel.ts";
export { contractBandView, contractsView } from "./contracts-view.ts";
export { voidContracts } from "./contracts-run.ts";
// Lagezentrum (Basis → Lage): alles Anstehende aller eigenen Häfen gebündelt; brief nur die Zahl fürs Navigationszeichen.
export { lageView, noLage, type LageAdvice, type LageJump, type LageRow, type LageUrgent, type LageView } from "./lage.ts";
export { lageAck, lageSince, SINCE_MAX_MS, type LageSince } from "./lage-since.ts"; // UX 0.43: Rückkehrkarte „Seit deinem letzten Besuch“
export { fullAtMs, pickVisit, VISIT_GROUP_MS, VISIT_HORIZON_MS, type LageVisit, type VisitReason } from "./lage-visit.ts"; // UX-0.43 B8
export { lageRemind, lageRemindCancel, lageReminder, REMIND_MAX_MS, REMIND_TYPE } from "./lage-remind.ts"; // UX-0.43 B8
export { nearFull, overtaker, RANK_CHECK_MS, runOvertakenPushes, runStoragePushes } from "./push-watch.ts"; // UX-0.43 B8
// Live-Verbindungen je Spieler (TE-04): Leck beim Trennen während der Prüfung, Neuprüfung der Sitzung, Obergrenze.
export { LiveHub, type LiveHubOptions, type LiveSocket } from "./live-sockets.ts";
// AN-06/AN-07: Saisonwechsel-Nachricht, Push-Bündel und Ruhezeit.
export * from "./season-notice.ts";
export { BUNDLE_PUSH_KINDS, bundlePayload, PUSH_BUNDLE_MS, pushQuietUntil, queuedPushes, URGENT_PUSH_KINDS } from "./push-bundle.ts";
export { cleanQuiet, getQuietHours, minuteOfDayIn, QUIET_DEFAULT, quietEndMs, quietHoursView, setQuietHours, type QuietHours } from "./push-quiet.ts";
// TST-09: „Alle abholen“ in einer Transaktion; TST-15/TX-08/TST-16: Lage-Ergänzungen.
export { claimAllIn, claimAllRewards, type ClaimAllResult, type ClaimSource } from "./rewards-claim.ts";
export { allianceRows, beginnerRow, BEGINNER_WARN_MS, rewardSourcesText, type RewardSources } from "./lage-social.ts";
// Weltpolitik: wirksame Balance, Plan, Seerat, Ansehen, Gesuche (docs/REGELN-WELTPOLITIK.md)
export { balanceNow, marketBalanceNow, seasonPlan, planAt, politikOff, invalidatePolitikCache, POLITIK_OFF, type PolitikPart } from "./politik-core.ts";
export { ensurePolitikPlan, POLITIK_HANDLERS } from "./politik-run.ts";
export { seeratVote, tallySitzung } from "./politik-seerat.ts";
export { ansehenAll, kiAccess, notoriousOf, notoriousBounty } from "./politik-ansehen.ts";
export { rufMap, rufOf, rufView, rufAllCached, clearRufCache, aechtungUntil } from "./politik-ruf.ts"; // Stufe 2: Ruf, Ächtung
export { syncStorms } from "./politik-core.ts"; // Stufe 2: Sturmzeit im Wetterfeld
export { runGesuche, offerGesuche, settleGesuche, acceptGesuch, declineGesuch } from "./politik-gesuche.ts";
export { politikOverview, politikKiView, politikMeta, politikAdminView, setPolitikOff, cancelPolitikWindow, effectLines, type EffectLine } from "./politik-view.ts";
export { kiPaktOffers, offerKiPacts, isKiOffer } from "./politik-pakt.ts";
export * from "./metrics.ts"; // Messbarkeit (Welle 2): Tagesschnappschuss je Hafen, Nutzungszähler je System
export * from "./worker-steps.ts"; // Worker-Schritte als Liste (Worker und Saisonlauf), Schrittdauer je Tag
export * from "./admin-balance.ts"; // Verwaltung: Rohstoffbilanz, Zuflüsse, Welt & Worker, Nutzung je System
