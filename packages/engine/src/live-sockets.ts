// Live-Verbindungen (WebSocket /ws) je Spieler – aus apps/api/src/main.ts ausgelagert, damit sie testbar ist (TE-04,
// Abschlussprüfung 0.38). Vorher: Schloss der Client während der Sitzungsprüfung, blieben Ping-Intervall und Eintrag
// für immer (close war schon vorbei); eine abgemeldete Sitzung bekam weiter Meldungen. Jetzt:
//  - close-Handler wird sofort angemeldet, nach der Prüfung zählt nur ein noch offener Socket;
//  - die Sitzung wird alle `recheckMs` erneut geprüft (abgemeldet/abgelaufen → Socket zu, 4401);
//  - höchstens `maxPerPlayer` Sockets je Spieler, der älteste wird geschlossen (4408).

/** Was der Hub von einem Socket braucht (ws/@fastify/websocket erfüllen das). */
export interface LiveSocket {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  on(event: "close", fn: () => void): unknown;
}

export interface LiveHubOptions {
  /** Sitzungscookie → Spieler-ID (null: ungültig). */
  validate: (token: string | undefined) => Promise<number | null>;
  maxPerPlayer?: number;
  pingMs?: number;
  recheckMs?: number;
  now?: () => number;
}

const OPEN = 1;

interface Entry {
  socket: LiveSocket;
  send: (s: string) => void;
  timers: ReturnType<typeof setInterval>[];
}

export class LiveHub {
  private readonly sockets = new Map<number, Set<Entry>>();
  private readonly o: Required<LiveHubOptions>;

  constructor(opts: LiveHubOptions) {
    this.o = { maxPerPlayer: 5, pingMs: 25_000, recheckMs: 600_000, now: Date.now, ...opts };
  }

  /** Verbindung annehmen; true, wenn sie registriert wurde. */
  async attach(socket: LiveSocket, token: string | undefined): Promise<boolean> {
    let closed = false;
    let entry: Entry | null = null;
    let playerId: number | null = null;
    socket.on("close", () => {
      closed = true;
      if (entry && playerId !== null) this.remove(playerId, entry);
    });
    const id = await this.o.validate(token).catch(() => null);
    if (closed || socket.readyState !== OPEN) return false; // Client hat während der Prüfung getrennt
    if (id === null) {
      socket.close(4401, "unauthorized");
      return false;
    }
    playerId = id;
    const e: Entry = { socket, send: (s) => { if (socket.readyState === OPEN) socket.send(s); }, timers: [] };
    entry = e;
    let set = this.sockets.get(id);
    if (!set) this.sockets.set(id, (set = new Set()));
    set.add(e);
    while (set.size > this.o.maxPerPlayer) {
      const oldest = set.values().next().value as Entry;
      this.remove(id, oldest);
      oldest.socket.close(4408, "too many connections");
    }
    e.send(JSON.stringify({ kind: "hello", serverNow: this.o.now() }));
    e.timers.push(setInterval(() => e.send(JSON.stringify({ kind: "ping", serverNow: this.o.now() })), this.o.pingMs));
    e.timers.push(setInterval(() => void this.recheck(id, e, token), this.o.recheckMs));
    return true;
  }

  /** Nachricht an Spieler (null: an alle). */
  publish(ids: number[] | null, message: string): void {
    if (ids === null) {
      for (const set of this.sockets.values()) for (const e of set) e.send(message);
      return;
    }
    for (const id of ids) for (const e of this.sockets.get(id) ?? []) e.send(message);
  }

  /** Anzahl registrierter Sockets (gesamt oder je Spieler). */
  count(playerId?: number): number {
    if (playerId !== undefined) return this.sockets.get(playerId)?.size ?? 0;
    let n = 0;
    for (const set of this.sockets.values()) n += set.size;
    return n;
  }

  private async recheck(id: number, e: Entry, token: string | undefined): Promise<void> {
    const now = await this.o.validate(token).catch(() => id); // DB-Fehler: Verbindung nicht kappen
    if (now === id) return;
    this.remove(id, e);
    e.socket.close(4401, "session ended");
  }

  private remove(id: number, e: Entry): void {
    for (const t of e.timers) clearInterval(t);
    e.timers.length = 0;
    const set = this.sockets.get(id);
    if (!set) return;
    set.delete(e);
    if (set.size === 0) this.sockets.delete(id);
  }
}
