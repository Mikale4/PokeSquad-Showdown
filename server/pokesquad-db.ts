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
 */
import { PGDatabase, SQL } from '../lib/database';

/** [userid, elo, username, w, l, t, lastUpdate], as server/ladders-local.ts keeps them */
export type LadderRow = [string, number, string, number, number, number, string];

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

/** The tables, once (false: the database can't be reached, and the server carries on without it) */
function setup() {
	const pg = database();
	if (!pg) return Promise.resolve(false);
	ready ||= pg.queryExec(SQL`CREATE TABLE IF NOT EXISTS pokesquad_ladder (
		formatid TEXT NOT NULL, userid TEXT NOT NULL, elo REAL NOT NULL, username TEXT NOT NULL,
		w INTEGER NOT NULL DEFAULT 0, l INTEGER NOT NULL DEFAULT 0, t INTEGER NOT NULL DEFAULT 0, updated TEXT NOT NULL DEFAULT '',
		PRIMARY KEY (formatid, userid))`).then(() => true, err => {
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
