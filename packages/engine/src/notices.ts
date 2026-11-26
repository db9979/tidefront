// Verteilt Benachrichtigungen nach dem Commit auf Push und E-Mail. Fehler werden nur protokolliert.
import { eq } from "drizzle-orm";
import { tables } from "@tidefront/db";
import type { Engine, Notice, NoticeJob } from "./context.ts";
import { mailNotice } from "./mail.ts";
import { pushToPlayer } from "./push.ts";

export async function deliverNotice(engine: Engine, playerId: number, notice: Notice): Promise<void> {
  try {
    await pushToPlayer(engine, playerId, notice);
  } catch (err) {
    engine.log("push error", String(err));
  }
  try {
    await mailNotice(engine, playerId, notice);
  } catch (err) {
    engine.log("mail error", String(err));
  }
}

export async function deliverNotices(engine: Engine, jobs: NoticeJob[]): Promise<void> {
  for (const j of jobs) await deliverNotice(engine, j.playerId, j.notice);
}

/** Hook für engine.push: läuft im Hintergrund, blockiert weder Ereignis noch Befehl. */
export function noticeHook(getEngine: () => Engine): (jobs: NoticeJob[]) => void {
  let chain = Promise.resolve();
  return (jobs) => {
    chain = chain.then(() => deliverNotices(getEngine(), jobs)).catch((err) => getEngine().log("notice error", String(err)));
  };
}

export async function adminIds(engine: Engine): Promise<number[]> {
  const rows = await engine.db.select({ id: tables.player.id }).from(tables.player).where(eq(tables.player.isAdmin, true));
  return rows.map((r) => r.id);
}

/** Benachrichtigung an alle Admins (Push und, falls eingerichtet, E-Mail). */
export async function noticeToAdmins(engine: Engine, notice: Notice): Promise<number> {
  const ids = await adminIds(engine);
  for (const id of ids) await deliverNotice(engine, id, notice);
  return ids.length;
}
