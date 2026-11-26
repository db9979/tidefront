// Links aus E-Mails, ohne Anmeldung nutzbar: Adresse bestätigen, Benachrichtigungen abbestellen.
import type { FastifyInstance } from "fastify";
import { esc, MAIL_THEME, unsubscribeEmail, verifyEmail, type Engine } from "@tidefront/engine";

function page(title: string, text: string): string {
  const t = MAIL_THEME;
  return `<!DOCTYPE html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark"><title>${esc(title)}</title>
<style>body{margin:0;font-family:${t.font};background:${t.darkPage};color:${t.darkText};display:grid;place-items:center;min-height:100vh}
main{max-width:420px;padding:28px;background:${t.darkPanel};border-radius:${t.radius};margin:16px}
h1{font-size:20px;margin:0 0 12px}a{display:inline-block;margin-top:16px;padding:12px 20px;background:${t.accent};color:${t.accentText};border-radius:${t.radius};text-decoration:none;font-weight:700}</style>
</head><body><main><div style="letter-spacing:4px;color:${t.headerText};font-weight:800;margin-bottom:16px">${esc(t.brand)}</div>
<h1>${esc(title)}</h1><p>${esc(text)}</p><a href="/">Zum Spiel</a></main></body></html>`;
}

export function registerMailLinks(app: FastifyInstance, engine: Engine, rateLimit: (b: string, l: number, w: number) => Promise<boolean>): void {
  app.get<{ Querystring: { t?: string } }>("/api/mail/verify", async (req, reply) => {
    reply.type("text/html; charset=utf-8").header("cache-control", "no-store").header("referrer-policy", "no-referrer");
    if (!(await rateLimit(`mlink:${req.ip}`, 30, 3600))) return reply.code(429).send(page("Zu viele Versuche", "Bitte später erneut versuchen."));
    const ok = await verifyEmail(engine.db, String(req.query.t ?? ""));
    return reply.code(ok ? 200 : 400).send(ok
      ? page("Adresse bestätigt", "Du erhältst ab jetzt E-Mail-Benachrichtigungen nach deinen Einstellungen.")
      : page("Link ungültig", "Der Link ist abgelaufen oder wurde schon benutzt. Fordere in den Einstellungen einen neuen an."));
  });
  const unsubscribe = async (token: string) => unsubscribeEmail(engine.db, token);
  app.get<{ Querystring: { t?: string } }>("/api/mail/unsubscribe", async (req, reply) => {
    reply.type("text/html; charset=utf-8").header("cache-control", "no-store").header("referrer-policy", "no-referrer");
    if (!(await rateLimit(`mlink:${req.ip}`, 30, 3600))) return reply.code(429).send(page("Zu viele Versuche", "Bitte später erneut versuchen."));
    const ok = await unsubscribe(String(req.query.t ?? ""));
    return reply.code(ok ? 200 : 400).send(ok
      ? page("Abbestellt", "Du erhältst keine E-Mail-Benachrichtigungen mehr. In den Einstellungen kannst du sie wieder einschalten.")
      : page("Link ungültig", "Dieser Abmeldelink ist nicht gültig."));
  });
  // Ein-Klick-Abmeldung (RFC 8058) aus dem Mailprogramm; der Formular-Körper wird nicht gebraucht.
  if (!app.hasContentTypeParser("application/x-www-form-urlencoded")) {
    app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string", bodyLimit: 4096 }, (_req, body, done) => done(null, body));
  }
  app.post<{ Querystring: { t?: string } }>("/api/mail/unsubscribe", async (req, reply) => {
    const ok = await unsubscribe(String(req.query.t ?? ""));
    return reply.code(ok ? 200 : 400).send({ ok });
  });
}
