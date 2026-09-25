import { createApp } from './app';
import { createAuth } from './auth';
import { loadConfig } from './config';
import { migrate, openDatabase } from './database';

const config = loadConfig(process.env);

// The database is brought up to date before anything is built on it, so a fresh
// checkout needs no step between cloning and running.
const database = openDatabase(config.databaseUrl);
await migrate(database);
const auth = await createAuth(config, database);
const app = createApp({ auth, config, database });

app.listen(config.port);

console.log(`Kira server listening on ${app.server?.url}`);
