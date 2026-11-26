// Integrationstests „Freunde einladen“ gegen ein echtes PostgreSQL (TEST_DATABASE_URL, wird geleert).
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { eq, sql } from "drizzle-orm";
import { createDb, migrateDb, tables } from "@tidefront/db";
import {
  adminInvites,
  blockInviteAddress,
  GameError,
  inviteByEmail,
  inviteLink,
  inviterForCode,
  listInvites,
  myInvites,
  notifyInviter,
  register,
  resendInvite,
  revokeInvite,
  saveInviteSettings,
  saveSmtp,
  seed,
  setMailSender,
  type Engine,
  type NoticeJob,
  type OutgoingMail,
} from "../src/index.ts";

const url = process.env.TEST_DATABASE_URL;
const { db, client } = createDb(url ?? "postgres://invalid", 10);
const pushed: NoticeJob[] = [];
const engine: Engine = { db, notify: () => {}, log: () => {}, push: (jobs) => pushed.push(...jobs) };
const sent: OutgoingMail[] = [];
let failNext = false;
const H = 3600000;
const D = 24 * H;

const code = (e: unknown) => (e instanceof GameError ? e.code : String(e));
async function rejects(p: Promise<unknown>, c: string) {
  await assert.rejects(p, (e: unknown) => code(e) === c || assert.fail(`erwartet ${c}, bekam ${code(e)}`));
}

before(async () => {
  if (!url) throw new Error("TEST_DATABASE_URL fehlt");
  await db.execute(sql`drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;`);
  await migrateDb(db);
  await seed(db, "TEST:100");
  delete process.env.ADMIN_NAMES;
  process.env.APP_SECRET = "test-geheimnis-0123456789abcdef";
  process.env.PUBLIC_URL = "https://spiel.example";
  setMailSender(async (_cfg, mail) => {
    if (failNext) {
      failNext = false;
      throw new Error("smtp kaputt");
    }
    sent.push(mail);
  });
});

after(async () => {
  setMailSender(null);
  await client.end();
});

let ada: number;
let bert: number;

async function mailOn() {
  await saveSmtp(db, {
    enabled: true, provider: "custom", host: "smtp.example", port: 587, security: "starttls", user: "u", fromName: "TF",
    fromAddress: "tf@example.org", password: "pw",
  });
}

test("ohne SMTP: Mail abgelehnt, Link geht; Link-Code nur einmal nutzbar", async () => {
  ada = (await register(db, { inviteCode: "TEST", name: "Ada", password: "geheim123" })).playerId; // erster Spieler = Admin
  bert = (await register(db, { inviteCode: "TEST", name: "Bert", password: "geheim123" })).playerId;
  await rejects(inviteByEmail(engine, bert, { email: "freund@example.org" }), "mail_off");
  const l = await inviteLink(engine, bert, { name: "Kalle" });
  assert.match(l.code, /^[A-Z2-9]{10}$/);
  assert.equal(l.url, `https://spiel.example/?invite=${l.code}`);
  assert.deepEqual(await inviterForCode(db, l.code), { inviterName: "Bert" });
  assert.deepEqual(await inviterForCode(db, "GIBTSNICHT"), { inviterName: null });
  assert.deepEqual(await inviterForCode(db, "TEST"), { inviterName: null }, "allgemeine Codes verraten nichts");
  // Persönliche Codes erscheinen nicht in der Liste allgemeiner Codes.
  assert.equal((await listInvites(db)).some((i) => i.code === l.code), false);

  const k = await register(db, { inviteCode: l.code, name: "Kalle", password: "geheim123" });
  await rejects(register(db, { inviteCode: l.code, name: "Kalle2", password: "geheim123" }), "invite_invalid");
  assert.deepEqual(await inviterForCode(db, l.code), { inviterName: null });

  // Benachrichtigung des Einladenden: Systemnachricht und Push/E-Mail-Auftrag.
  pushed.length = 0;
  assert.equal(await notifyInviter(engine, k.playerId), bert);
  const [m] = await db.select().from(tables.message).where(eq(tables.message.toPlayerId, bert));
  assert.equal(m.fromPlayerId, null);
  assert.match(m.body, /Kalle ist deiner Einladung gefolgt/);
  assert.equal(pushed.length, 1);
  assert.equal(pushed[0].playerId, bert);
  assert.equal(pushed[0].notice.title, "Einladung angenommen");
  assert.equal(await notifyInviter(engine, bert), null, "ohne Einladung keine Meldung");

  const mine = await myInvites(engine, bert);
  assert.equal(mine.invites[0].status, "accepted");
  assert.equal(mine.invites[0].acceptedName, "Kalle");
  assert.equal(mine.invites[0].code, null, "verbrauchter Code wird nicht mehr gezeigt");
  assert.equal(mine.mailReady, false);
});

test("E-Mail: Rendering mit Name, Code, Link, Nachricht, Sperrlink; hell/dunkel und Textversion", async () => {
  await mailOn();
  sent.length = 0;
  const r = await inviteByEmail(engine, bert, { email: "Freund@Example.org", name: "Fritz", message: "Komm an Bord <b>jetzt</b>!" });
  assert.equal(sent.length, 1);
  const m = sent[0];
  assert.equal(m.to, "Freund@Example.org");
  assert.equal(m.subject, "TIDEFRONT: Bert lädt dich ein");
  assert.ok(m.html.includes(`https://spiel.example/?invite=${r.code}`));
  assert.ok(m.html.includes("Einladung annehmen"));
  assert.ok(m.html.includes(r.code));
  assert.ok(m.html.includes("Hallo Fritz,"));
  assert.ok(m.html.includes("Komm an Bord &lt;b&gt;jetzt&lt;/b&gt;!"), "Nachricht wird maskiert");
  assert.ok(!m.html.includes("<b>jetzt</b>"));
  assert.ok(m.html.includes("prefers-color-scheme: dark"));
  assert.ok(m.html.includes("Du kennst den Absender nicht? Ignoriere diese Mail"));
  assert.ok(m.html.includes("Keine Einladungen mehr an diese Adresse"));
  assert.match(m.html, /\/api\/mail\/invite-block\?t=[0-9a-f]{48}/);
  assert.match(m.headers!["List-Unsubscribe"], /invite-block\?t=[0-9a-f]{48}/);
  assert.ok(m.text.includes(`Einladungscode: ${r.code}`));
  assert.ok(m.text.includes("Gültig bis: "));
  assert.ok(m.text.includes("Keine Einladungen mehr an diese Adresse: https://spiel.example/api/mail/invite-block?t="));
  const mine = await myInvites(engine, bert);
  const inv = mine.invites.find((i) => i.id === r.id)!;
  assert.equal(inv.status, "sent");
  assert.equal(inv.canResend, false, "erneut senden erst nach 24 h");
  assert.equal(inv.friendName, "Fritz");
});

test("Grenzen: gleiche Adresse, Mitglieder, offene und wöchentliche Einladungen, Abschalten", async () => {
  // Dieselbe Adresse (auch anders geschrieben, auch von anderem Spieler) innerhalb von 7 Tagen.
  await rejects(inviteByEmail(engine, ada, { email: "freund@example.ORG" }), "invite_recent");
  await rejects(inviteByEmail(engine, bert, { email: "kein-mail" }), "bad_email");
  // Bestätigte Adresse eines Spielers.
  await db.insert(tables.playerEmail).values({ playerId: ada, email: "ada@example.org", verifiedAt: new Date(), unsubscribeToken: "x".repeat(48) });
  await rejects(inviteByEmail(engine, bert, { email: "ADA@example.org" }), "invite_member");
  // Offene Einladungen: Bert hat 1 offene (Fritz); Vorgabe 5.
  await saveInviteSettings(db, { enabled: true, maxOpen: 3, maxWeek: 4 });
  await inviteLink(engine, bert, {});
  const third = await inviteLink(engine, bert, {});
  await rejects(inviteLink(engine, bert, {}), "invite_open_limit");
  // Zurückziehen macht Platz, zählt aber für die Woche (Kalle, Fritz, 2 Links = 4).
  await revokeInvite(db, bert, third.id);
  await rejects(revokeInvite(db, bert, third.id), "no_invite");
  await rejects(revokeInvite(db, ada, third.id), "no_invite");
  await rejects(register(db, { inviteCode: third.code, name: "Zurueck", password: "geheim123" }), "invite_invalid");
  await rejects(inviteLink(engine, bert, {}), "invite_week_limit");
  assert.equal((await myInvites(engine, bert)).invites.find((i) => i.id === third.id)!.status, "revoked");
  // Abschalten gilt nicht für Admins.
  await saveInviteSettings(db, { enabled: false, maxOpen: 5, maxWeek: 10 });
  await rejects(inviteLink(engine, bert, {}), "invite_off");
  assert.equal((await myInvites(engine, bert)).allowed, false);
  await inviteLink(engine, ada, {});
  await saveInviteSettings(db, { enabled: true, maxOpen: 5, maxWeek: 10 });
});

test("Versandfehler: keine Einladung bleibt zurück", async () => {
  const before = (await db.select().from(tables.playerInvite)).length;
  failNext = true;
  await rejects(inviteByEmail(engine, ada, { email: "neu@example.org" }), "mail_failed");
  assert.equal((await db.select().from(tables.playerInvite)).length, before);
  // Danach ist dieselbe Adresse nicht durch die 7-Tage-Regel blockiert.
  await inviteByEmail(engine, ada, { email: "neu@example.org" });
});

test("Ablauf und erneut senden: abgelaufen nicht nutzbar, erneut senden nach 24 h verlängert", async () => {
  const [fritz] = await db.select().from(tables.playerInvite).where(sql`lower(${tables.playerInvite.email}) = 'freund@example.org'`);
  const now = Date.now();
  await rejects(resendInvite(engine, bert, fritz.id, now), "invite_too_soon");
  // 15 Tage später: abgelaufen.
  const later = now + 15 * D;
  await db.update(tables.playerInvite).set({ expiresAt: new Date(now - 1000) }).where(eq(tables.playerInvite.id, fritz.id));
  await rejects(register(db, { inviteCode: fritz.code, name: "Fritz", password: "geheim123" }), "invite_invalid");
  assert.deepEqual(await inviterForCode(db, fritz.code), { inviterName: null });
  const mine = await myInvites(engine, bert, later);
  assert.equal(mine.invites.find((i) => i.id === fritz.id)!.status, "expired");
  assert.equal(mine.invites.find((i) => i.id === fritz.id)!.canResend, true);
  sent.length = 0;
  await resendInvite(engine, bert, fritz.id, Date.now() + 25 * H);
  assert.equal(sent.length, 1);
  const [after1] = await db.select().from(tables.playerInvite).where(eq(tables.playerInvite.id, fritz.id));
  assert.equal(after1.sendCount, 2);
  assert.ok(after1.expiresAt.getTime() > Date.now() + 14 * D, "Gültigkeit verlängert");
  await rejects(resendInvite(engine, bert, fritz.id, Date.now() + 26 * H), "invite_too_soon");
  await resendInvite(engine, bert, fritz.id, Date.now() + 50 * H);
  await rejects(resendInvite(engine, bert, fritz.id, Date.now() + 80 * H), "invite_resend_max");
  // Jetzt wieder gültig: Registrierung über den Code (Link aus der Mail).
  const f = await register(db, { inviteCode: fritz.code, name: "Fritz", password: "geheim123" });
  assert.equal(await notifyInviter(engine, f.playerId), bert);
  assert.equal((await myInvites(engine, bert)).invites.find((i) => i.id === fritz.id)!.status, "accepted");
});

test("Sperrlink: Adresse gesperrt, offene Einladungen zurückgezogen; Admin sieht alle", async () => {
  const r = await inviteByEmail(engine, bert, { email: "Nein.Danke@example.org" });
  const [row] = await db.select().from(tables.playerInvite).where(eq(tables.playerInvite.id, r.id));
  assert.equal(await blockInviteAddress(db, "f".repeat(48)), false);
  assert.equal(await blockInviteAddress(db, "kaputt"), false);
  assert.equal(await blockInviteAddress(db, row.blockToken!), true);
  assert.equal(await blockInviteAddress(db, row.blockToken!), true, "zweimal ist harmlos");
  await rejects(register(db, { inviteCode: r.code, name: "Nein", password: "geheim123" }), "invite_invalid");
  const [blocked] = await db.select().from(tables.inviteBlock);
  assert.match(blocked.emailHash, /^[0-9a-f]{64}$/, "nur als Hash gespeichert");
  await rejects(inviteByEmail(engine, ada, { email: "nein.danke@EXAMPLE.org" }), "invite_blocked");
  await rejects(resendInvite(engine, bert, r.id, Date.now() + 30 * H), "no_invite");

  const all = await adminInvites(db);
  assert.ok(all.length >= 6);
  const fritz = all.find((i) => i.friendName === "Fritz")!;
  assert.equal(fritz.inviterName, "Bert");
  assert.equal(fritz.acceptedName, "Fritz");
  assert.equal(all.find((i) => i.id === r.id)!.status, "revoked");
});
