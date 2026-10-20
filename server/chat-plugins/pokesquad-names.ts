/**
 * PokeSquad Battler: registered names, without Showdown's login server (server/pokesquad-db.ts keeps them, in the database
 * set by DATABASE_URL). The site's Register, Password and Log out buttons send these; nobody types them into chat, so a
 * password never sits in a chat box or its history. Passwords come URL-encoded (spaces and commas survive).
 * Taking a registered name is checked in users.ts (validateToken: PokeSquadDB.checkName). Upload and share replay (savereplay,
 * replacing Showdown's, which needs its replay server) saves the battle in the same database.
 */
import * as crypto from 'crypto';
import * as PokeSquadDB from '../pokesquad-db';

/** The site keeps a remembered login (30 days) and the name it's for */
function sendSession(connection: Connection, user: User, token: string) {
	connection.send(`|pokesquadsession|${user.id}|${token}|${user.name}`);
}

export const commands: Chat.ChatCommands = {
	async pokesquadregister(target, room, user, connection) {
		if (!PokeSquadDB.enabled()) return this.popupReply(`This server can't register names yet: it has no database.`);
		if (!user.named) return this.popupReply(`Choose a name first, then register it.`);
		if (user.registered) return this.popupReply(`"${user.name}" is already registered.`);
		const password = PokeSquadDB.readPassword(target.trim());
		if (password === null) return this.popupReply(`That password couldn't be read.`);
		try {
			const token = await PokeSquadDB.register(user.id, user.name, password);
			user.forceRename(user.name, true); // (registered now: an administrator's rank comes with it, POKESQUAD_ADMINS)
			sendSession(connection, user, token);
			this.popupReply(`"${user.name}" is registered. From now on, choosing this name asks for its password (this browser remembers you for 30 days).`);
		} catch (err: any) {
			this.popupReply(err.message);
		}
	},
	pokesquadregisterhelp: [`/pokesquadregister [password] - Registers the name you're using (the site's Register button sends it).`],

	async pokesquadpassword(target, room, user, connection) {
		if (!PokeSquadDB.enabled()) return this.popupReply(`This server has no database, so there are no passwords to change.`);
		if (!user.named || !user.registered) return this.popupReply(`Use your registered name first.`);
		const [oldPassword, password] = target.trim().split(' ').map(PokeSquadDB.readPassword);
		if (oldPassword === null || password === null || password === undefined) return this.popupReply(`Those passwords couldn't be read.`);
		try {
			const token = await PokeSquadDB.changePassword(user.id, oldPassword, password);
			sendSession(connection, user, token);
			this.popupReply(`Your password is changed. Every other browser that remembered you has to log in again.`);
		} catch (err: any) {
			this.popupReply(err.message);
		}
	},
	pokesquadpasswordhelp: [`/pokesquadpassword [old password] [new password] - Changes your password (the site's Password button sends it).`],

	async pokesquadforget(target) {
		await PokeSquadDB.forgetSession(target.trim());
	},

	// Upload and share replay: into the database (there's no replay server here), a link to the site's replay page
	uploadreplay: 'savereplay',
	async savereplay(target, room, user, connection) {
		if (!room?.battle) throw new Chat.ErrorMessage(`You can only save replays for battles.`);
		if (!PokeSquadDB.enabled()) {
			return this.popupReply(`This server can't share replays yet: it has no database. Use Download replay instead.`);
		}
		const battle: AnyObject = room.battle;
		const format = Dex.formats.get(room.format || battle.format, true);
		// (the same battle saved again keeps its link; a random id, since Render restarts the battle counter)
		battle.pokesquadReplay ||= `${format.id}-${crypto.randomBytes(6).toString('hex')}`;
		try {
			const id = await PokeSquadDB.saveReplay({
				id: battle.pokesquadReplay, format: format.name, players: battle.players.map((p: AnyObject) => p.name),
				log: room.getLog(0), rating: battle.ended && room.rated ? Math.round(room.rated) : null,
			});
			const url = `${PokeSquadDB.SITE()}/replay.html#${id}`;
			if (target === 'silent') return;
			connection.popup(
				`|html|<p>Your replay has been uploaded! It's available at:</p><p> ` +
				`<a class="no-panel-intercept" href="${url}" target="_blank">${url}</a> <copytext value="${url}">Copy</copytext></p>`
			);
		} catch (err: any) {
			this.popupReply(`Your replay couldn't be saved: ${err.message}`);
		}
	},
	savereplayhelp: [`/savereplay - Shares this battle's replay: a link to it on the site's replay page.`],
};
