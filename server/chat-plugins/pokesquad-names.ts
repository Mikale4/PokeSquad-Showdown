/**
 * PokeSquad Battler: registered names, without Showdown's login server (server/pokesquad-db.ts keeps them, in the database
 * set by DATABASE_URL). The site's Register, Password and Log out buttons send these; nobody types them into chat, so a
 * password never sits in a chat box or its history. Passwords come URL-encoded (spaces and commas survive).
 * Taking a registered name is checked in users.ts (validateToken: PokeSquadDB.checkName).
 */
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
			user.registered = true;
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
};
