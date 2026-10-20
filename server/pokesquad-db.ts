/**
 * PokeSquad Battler's database
 *
 * Render's free plan wipes the server's disk whenever it sleeps (15 minutes with nobody on) or redeploys, so what has to last
 * lives in a Postgres database instead (the owner's pick, 2026-10-20: a free one, such as Neon). Its connection string is
 * DATABASE_URL in Render's settings, the owner's own: it's never in this repo.
 *
 * Without DATABASE_URL nothing changes: the ladder stays in config/ladders/[formatid].tsv (server/ladders-local.ts).
 *
 * Tables, made on first use:
 * - pokesquad_ladder: each player's rating in each format (the ladder's rows: server/ladders-local.ts)
 * - pokesquad_names: registered names (there's no Showdown login server here): each one's password, kept only as a salted
 *   scrypt hash. Taking a registered name needs its password, or a remembered session (users.ts, validateToken: checkName)
 * - pokesquad_sessions: the remembered logins, kept only as SHA-256 hashes of their tokens, for 30 days from their last use
 * - pokesquad_replays: shared replays (Upload and share replay: server/chat-plugins/pokesquad-names.ts, savereplay), each
 *   battle's spectator log, read by the site's replay page through GET /pokesquad-replay/<id> (httpResponse)
 */
import * as crypto from 'crypto';
import { PGDatabase, SQL } from '../lib/database';
import { toID } from '../sim/dex';

/** [userid, elo, username, w, l, t, lastUpdate], as server/ladders-local.ts keeps them */
export type LadderRow = [string, number, string, number, number, number, string];

/** The server's own bot (chat-plugins/pokesquad-bot.ts): its name, which only it can take with this process's secret token */
export const BOT_NAME = 'PokeSquad Bot', BOT_ID = 'pokesquadbot';
export const botToken = crypto.randomBytes(24).toString('hex');

let db: PGDatabase | null = null;
let ready: Promise<boolean> | null = null;

/** The database, if DATABASE_URL is set (a test passes its own: useDatabase) */
function database() {
	if (!db && process.env.DATABASE_URL) {
		db = new PGDatabase({ connectionString: process.env.DATABASE_URL, max: 3, idleTimeoutMillis: 30000 });
	}
	return db;
}
export function useDatabase(testDB: PGDatabase | null) {
	db = testDB;
	ready = null;
}
export const enabled = () => !!database();

/**
 * The administrators: POKESQUAD_ADMINS (render.yaml), their names, comma-separated ("admin" if it isn't set). A name only
 * gets the rank once it's logged in with its password or a remembered login (users.ts, updateGroup: registered), which needs
 * the database.
 */
export const isAdmin = (userid: string) =>
	enabled() && (process.env.POKESQUAD_ADMINS ?? 'admin').split(',').map(toID).filter(Boolean).includes(userid as ID);

/** The tables, once (false: the database can't be reached, and the server carries on without it) */
function setup() {
	const pg = database();
	if (!pg) return Promise.resolve(false);
	ready ||= (async () => {
		await pg.queryExec(SQL`CREATE TABLE IF NOT EXISTS pokesquad_ladder (
			formatid TEXT NOT NULL, userid TEXT NOT NULL, elo REAL NOT NULL, username TEXT NOT NULL,
			w INTEGER NOT NULL DEFAULT 0, l INTEGER NOT NULL DEFAULT 0, t INTEGER NOT NULL DEFAULT 0, updated TEXT NOT NULL DEFAULT '',
			PRIMARY KEY (formatid, userid))`);
		await pg.queryExec(SQL`CREATE TABLE IF NOT EXISTS pokesquad_names (
			userid TEXT PRIMARY KEY, name TEXT NOT NULL, salt TEXT NOT NULL, hash TEXT NOT NULL, created TEXT NOT NULL DEFAULT '')`);
		await pg.queryExec(SQL`CREATE TABLE IF NOT EXISTS pokesquad_sessions (
			token TEXT PRIMARY KEY, userid TEXT NOT NULL, expires BIGINT NOT NULL)`);
		await pg.queryExec(SQL`CREATE TABLE IF NOT EXISTS pokesquad_replays (
			id TEXT PRIMARY KEY, format TEXT NOT NULL, players TEXT NOT NULL, log TEXT NOT NULL, rating INTEGER,
			uploaded BIGINT NOT NULL, views INTEGER NOT NULL DEFAULT 0)`);
	})().then(() => true, err => {
		Monitor.crashlog(err, 'PokeSquad database setup');
		ready = null; // (it tries again next time)
		return false;
	});
	return ready;
}

/** A format's ladder, best first (null: no database, or it can't be reached) */
export async function loadLadder(formatid: string): Promise<LadderRow[] | null> {
	if (!await setup()) return null;
	try {
		const rows = await database()!.query<{ userid: string, elo: number, username: string, w: number, l: number, t: number, updated: string }>(
			SQL`SELECT userid, elo, username, w, l, t, updated FROM pokesquad_ladder WHERE formatid = ${formatid} ORDER BY elo DESC`
		);
		const ladder = rows.map(r => [r.userid, Number(r.elo), r.username, Number(r.w), Number(r.l), Number(r.t), r.updated] as LadderRow);
		for (const row of ladder) saved.set(`${formatid}:${row[0]}`, JSON.stringify(row));
		return ladder;
	} catch (err: any) {
		Monitor.crashlog(err, 'PokeSquad ladder load');
		return null;
	}
}

/** What each row was when it was last read or written: only the rows that changed are written */
const saved = new Map<string, string>();

/** A format's ladder, its changed rows written (false: not saved) */
export async function saveLadder(formatid: string, ladder: LadderRow[]) {
	if (!await setup()) return false;
	try {
		for (const row of ladder) {
			const key = `${formatid}:${row[0]}`, now = JSON.stringify(row);
			if (saved.get(key) === now) continue;
			const [userid, elo, username, w, l, t, updated] = row;
			await database()!.queryExec(SQL`INSERT INTO pokesquad_ladder (formatid, userid, elo, username, w, l, t, updated)
				VALUES (${formatid}, ${userid}, ${elo}, ${username}, ${w}, ${l}, ${t}, ${updated || ''})
				ON CONFLICT (formatid, userid) DO UPDATE SET
				elo = EXCLUDED.elo, username = EXCLUDED.username, w = EXCLUDED.w, l = EXCLUDED.l, t = EXCLUDED.t, updated = EXCLUDED.updated`);
			saved.set(key, now);
		}
		return true;
	} catch (err: any) {
		Monitor.crashlog(err, 'PokeSquad ladder save');
		return false;
	}
}

// ---------- registered names ----------

const SESSION_DAYS = 30;
const hashOf = (password: string, salt: string) => new Promise<string>((resolve, reject) => {
	crypto.scrypt(password, salt, 64, (err, key) => err ? reject(err) : resolve(key.toString('hex')));
});
const sameHash = (a: string, b: string) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
const tokenHash = (token: string) => crypto.createHash('sha256').update(token).digest('hex');
/** A password as the site sends it (URL-encoded, so spaces and commas survive): the password, or null */
export function readPassword(sent: string) {
	try {
		return decodeURIComponent(sent);
	} catch {
		return null;
	}
}
export const passwordProblem = (password: string) =>
	password.length < 6 ? `A password needs at least 6 characters.` :
	password.length > 100 ? `A password can be 100 characters at most.` : null;

interface NameRow { userid: string; name: string; salt: string; hash: string }
/** A name's registration: its row, null if it's free, undefined if the database can't be reached */
async function nameRow(userid: string): Promise<NameRow | null | undefined> {
	if (!await setup()) return undefined;
	try {
		return (await database()!.queryOne<NameRow>(
			SQL`SELECT userid, name, salt, hash FROM pokesquad_names WHERE userid = ${userid}`
		)) || null;
	} catch (err: any) {
		Monitor.crashlog(err, 'PokeSquad name lookup');
		return undefined;
	}
}
async function rightPassword(row: NameRow, password: string) {
	return sameHash(await hashOf(password, row.salt), row.hash);
}
/** A remembered login for the name: its token (only its hash is kept) */
async function newSession(userid: string) {
	const token = crypto.randomBytes(24).toString('hex');
	await database()!.queryExec(SQL`INSERT INTO pokesquad_sessions (token, userid, expires)
		VALUES (${tokenHash(token)}, ${userid}, ${Date.now() + SESSION_DAYS * 86400000})`);
	return token;
}

export type NameCheck = { ok: true, registered: boolean, name?: string, session?: string } | { ok: false, message: string };
/**
 * Taking a name: a free one is anyone's; a registered one needs its password ("pspw:" and the URL-encoded password) or a
 * remembered session ("psst:" and its token). If the database can't be reached, names are open (the server keeps running).
 */
export async function checkName(userid: string, token: string): Promise<NameCheck> {
	const row = await nameRow(userid);
	if (!row) return { ok: true, registered: false };
	const needed = `PokeSquad: "${row.name}" is registered. Enter its password.`;
	try {
		if (token.startsWith('pspw:')) {
			const password = readPassword(token.slice(5));
			if (password === null || !await rightPassword(row, password)) {
				return { ok: false, message: `PokeSquad: wrong password for "${row.name}".` };
			}
			return { ok: true, registered: true, name: row.name, session: await newSession(userid) };
		}
		if (token.startsWith('psst:')) {
			const hashed = tokenHash(token.slice(5));
			const session = await database()!.queryOne<{ expires: string }>(
				SQL`SELECT expires FROM pokesquad_sessions WHERE token = ${hashed} AND userid = ${userid}`
			);
			if (!session || Number(session.expires) < Date.now()) return { ok: false, message: needed };
			await database()!.queryExec(
				SQL`UPDATE pokesquad_sessions SET expires = ${Date.now() + SESSION_DAYS * 86400000} WHERE token = ${hashed}`
			);
			return { ok: true, registered: true, name: row.name, session: token.slice(5) };
		}
	} catch (err: any) {
		Monitor.crashlog(err, 'PokeSquad name check');
		return { ok: false, message: `PokeSquad: the name check failed. Try again.` };
	}
	return { ok: false, message: needed };
}

/** Registers a name with a password: a remembered session's token, or an Error with a message for the player */
export async function register(userid: string, name: string, password: string) {
	const problem = passwordProblem(password);
	if (problem) throw new Error(problem);
	const row = await nameRow(userid);
	if (row === undefined) throw new Error(`The server's database can't be reached right now. Try again in a minute.`);
	if (row) throw new Error(`"${row.name}" is already registered.`);
	const salt = crypto.randomBytes(16).toString('hex');
	await database()!.queryExec(SQL`INSERT INTO pokesquad_names (userid, name, salt, hash, created)
		VALUES (${userid}, ${name}, ${salt}, ${await hashOf(password, salt)}, ${new Date().toISOString()})`);
	return newSession(userid);
}

/** A new password (the old one first): every other remembered login ends; the new session's token */
export async function changePassword(userid: string, oldPassword: string, password: string) {
	const problem = passwordProblem(password);
	if (problem) throw new Error(problem);
	const row = await nameRow(userid);
	if (row === undefined) throw new Error(`The server's database can't be reached right now. Try again in a minute.`);
	if (!row) throw new Error(`This name isn't registered.`);
	if (!await rightPassword(row, oldPassword)) throw new Error(`Your old password is wrong.`);
	const salt = crypto.randomBytes(16).toString('hex');
	await database()!.queryExec(
		SQL`UPDATE pokesquad_names SET salt = ${salt}, hash = ${await hashOf(password, salt)} WHERE userid = ${userid}`
	);
	await database()!.queryExec(SQL`DELETE FROM pokesquad_sessions WHERE userid = ${userid}`);
	return newSession(userid);
}

/** Logging out: that remembered login ends */
export async function forgetSession(token: string) {
	if (!token || !await setup()) return;
	try {
		await database()!.queryExec(SQL`DELETE FROM pokesquad_sessions WHERE token = ${tokenHash(token)}`);
	} catch (err: any) {
		Monitor.crashlog(err, 'PokeSquad logout');
	}
}

// ---------- shared replays ----------

/** The site whose replay page plays a shared replay (POKESQUAD_SITE in Render, if it ever moves) */
export const SITE = () => (process.env.POKESQUAD_SITE || 'https://mikale4.github.io/PokeSquad-Showdown-Client').replace(/\/+$/, '');

export interface SharedReplay { id: string; format: string; players: string[]; log: string; rating: number | null; uploaded: number }

/** A battle's replay, saved or saved again under the same id (an Error if the database can't take it) */
export async function saveReplay(replay: Omit<SharedReplay, 'uploaded'>) {
	if (!await setup()) throw new Error(`The server's database can't be reached right now. Try again in a minute.`);
	const { id, format, log, rating } = replay, players = replay.players.join(','), uploaded = Date.now();
	await database()!.queryExec(SQL`INSERT INTO pokesquad_replays (id, format, players, log, rating, uploaded)
		VALUES (${id}, ${format}, ${players}, ${log}, ${rating}, ${uploaded})
		ON CONFLICT (id) DO UPDATE SET log = EXCLUDED.log, rating = EXCLUDED.rating, uploaded = EXCLUDED.uploaded`);
	return id;
}

/** A shared replay (null: none with that id; undefined: the database can't be reached) */
export async function getReplay(id: string): Promise<SharedReplay | null | undefined> {
	if (!await setup()) return undefined;
	try {
		const row = await database()!.queryOne<{ id: string, format: string, players: string, log: string, rating: number | null, uploaded: string }>(
			SQL`SELECT id, format, players, log, rating, uploaded FROM pokesquad_replays WHERE id = ${id}`
		);
		if (!row) return null;
		void database()!.queryExec(SQL`UPDATE pokesquad_replays SET views = views + 1 WHERE id = ${id}`).catch(() => {});
		return { ...row, players: row.players.split(','), uploaded: Number(row.uploaded) };
	} catch (err: any) {
		Monitor.crashlog(err, 'PokeSquad replay read');
		return undefined;
	}
}

/**
 * The site's replay page reads a shared replay here: GET /pokesquad-replay/<id> answers its JSON, for any site (CORS). Called
 * by Config.customhttpresponse (config/config-example.js); true when it's this request's answer.
 */
export function httpResponse(req: { url?: string, method?: string }, res: AnyObject) {
	const match = /^\/pokesquad-replay\/([a-z0-9-]{1,80})(?:[?#].*)?$/.exec(req.url || '');
	if (!match) return false;
	const send = (status: number, body: AnyObject) => {
		res.writeHead(status, {
			'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-cache',
		});
		res.end(JSON.stringify(body));
	};
	if (req.method === 'OPTIONS') {
		res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET' });
		res.end();
		return true;
	}
	if (!enabled()) {
		send(503, { error: `This server keeps no replays: it has no database.` });
		return true;
	}
	void getReplay(match[1]).then(replay => {
		if (replay === undefined) send(503, { error: `The server's database can't be reached right now. Try again in a minute.` });
		else if (!replay) send(404, { error: `There's no replay with that link.` });
		else send(200, replay);
	});
	return true;
}
