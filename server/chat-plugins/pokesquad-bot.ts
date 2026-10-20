/**
 * PokeSquad Bot (the owner's ask, 2026-10-20): a player on the server that anyone can battle, so nobody needs a second tab to
 * battle themselves. It runs in the server itself: at startup it connects to the server's own websocket as "PokeSquad Bot" (a
 * name only it can take: pokesquad-db.ts, botToken; users.ts), and accepts every [Gen 9] PokeSquad challenge with one of the
 * game's top Trainers' teams (pokesquad/bot-teams.json, made by the game's tools/build_bot_teams.js: each archetype's plan,
 * optimized at Lv 100). It plays with the game's own battle AI: every choice it sends is Showdown's "default", which the game's
 * engine answers with its AI (tools/showdown_adapter.js, the same one that plays for a player whose timer runs out).
 */
import * as fs from 'fs';
import * as path from 'path';
import { Teams } from '../../sim/teams';
import * as PokeSquadDB from '../pokesquad-db';

const FORMAT = 'gen9pokesquad';
const THINK_MS = 700; // (a moment before each choice, so its moves don't land on top of each other)

let teams: { name: string, team: PokemonSet[] }[] = [];
function loadTeams() {
	for (const file of [path.resolve(__dirname, '../../../pokesquad/bot-teams.json'), path.resolve(__dirname, '../../pokesquad/bot-teams.json')]) {
		try {
			teams = JSON.parse(fs.readFileSync(file, 'utf8'));
			if (teams.length) return;
		} catch {}
	}
}

/** The battles the bot has greeted */
const greeted = new Set<string>();
let socket: AnyObject | null = null;

/** Which plan the bot brought, from its own Pokémon in a request (two challenges at once can't mix them up) */
function planOf(request: AnyObject) {
	const species = (request.side?.pokemon || []).map((p: AnyObject) => toID(String(p.details).split(',')[0])).sort().join();
	const team = teams.find(t => t.team.map(s => toID(s.species)).sort().join() === species);
	return team ? team.name : '';
}

function send(line: string) {
	if (socket && socket.readyState === 1) socket.send(line);
}

function accept(challenger: string) {
	if (!teams.length) loadTeams();
	if (!teams.length) return send(`|/pm ${challenger}, Sorry, I have no teams right now.`);
	const pick = teams[Math.floor(Math.random() * teams.length)];
	send(`|/utm ${Teams.pack(pick.team)}`);
	send(`|/accept ${challenger}`);
}

function receive(data: string) {
	const lines = data.split('\n');
	const roomid = lines[0].startsWith('>') ? lines[0].slice(1) : '';
	for (const line of lines) {
		if (line.startsWith('|challstr|')) {
			send(`|/trn ${PokeSquadDB.BOT_NAME},0,psbot:${PokeSquadDB.botToken}`);
		} else if (line.startsWith('|pm|')) {
			// |pm|SENDER|RECEIVER|MESSAGE
			const parts = line.split('|'), from = toID(parts[2]), message = parts.slice(4).join('|');
			if (!from || from === PokeSquadDB.BOT_ID) continue;
			if (message.startsWith('/challenge')) {
				const format = toID(message.slice(10).split('|')[0]);
				if (format === FORMAT) accept(from);
				else send(`|/reject ${from}`);
			} else if (!message.startsWith('/')) {
				send(`|/pm ${from}, Hi! Challenge me to a [Gen 9] PokeSquad battle and I'll play one of the game's top Trainer teams.`);
			}
		} else if (roomid.startsWith('battle-')) {
			if (line.startsWith('|request|') && line.length > 10) {
				let request: AnyObject;
				try {
					request = JSON.parse(line.slice(9));
				} catch {
					continue;
				}
				if (!greeted.has(roomid)) {
					greeted.add(roomid);
					const plan = planOf(request);
					setTimeout(() => send(`${roomid}|Good luck!${plan ? ` I'm playing a ${plan} team.` : ''}`), 1500);
				}
				if (request.wait) continue;
				const choice = request.teamPreview ? 'team 123456' : 'default';
				setTimeout(() => send(`${roomid}|/choose ${choice}|${request.rqid}`), THINK_MS);
			} else if (line.startsWith('|win|') || line === '|tie') {
				setTimeout(() => send(`${roomid}|gg!`), 1500);
				setTimeout(() => {
					send(`|/leave ${roomid}`);
					greeted.delete(roomid);
				}, 15000);
			}
		}
	}
}

function connect() {
	const WS = (globalThis as any).WebSocket;
	if (!WS) return; // (Node 22 has one built in)
	if (!teams.length) loadTeams();
	const ws = new WS(`ws://127.0.0.1:${Config.port}/showdown/websocket`);
	socket = ws;
	ws.onmessage = (ev: AnyObject) => {
		try {
			receive(String(ev.data));
		} catch (err: any) {
			Monitor.crashlog(err, 'PokeSquad Bot');
		}
	};
	ws.onclose = () => {
		if (socket === ws) socket = null;
		setTimeout(connect, 15000); // (back in a moment if the connection drops)
	};
	ws.onerror = () => {};
}

// once per server process, a few seconds after it starts listening (a chat plugin can load again on a hotpatch)
if (!(global as any).__pokesquadBot) {
	(global as any).__pokesquadBot = true;
	setTimeout(connect, 5000);
}

export const commands: Chat.ChatCommands = {};
