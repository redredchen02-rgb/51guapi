import dotenv from "dotenv";
import { buildApp, registerDraftRoutes, startBackgroundJobs } from "./app.js";
import { validateEnv } from "./config/env-check.js";

// Prefer ~/.51publisher/.env (outside repo, safe from accidental overwrites) over the in-repo .env
const safeEnvPath = `${process.env.HOME}/.51publisher/.env`;
dotenv.config({ path: safeEnvPath });
dotenv.config(); // fallback: load in-repo .env for any vars not already set

const gracefulShutdown = async (
	signal: string,
	app: Awaited<ReturnType<typeof buildApp>>,
) => {
	app.log.info(`Received ${signal}, shutting down gracefully...`);
	try {
		await app.close();
		app.log.info("Server closed gracefully");
	} catch (err) {
		app.log.error(err, "Error during graceful shutdown");
	}
	process.exit(0);
};

const start = async () => {
	try {
		validateEnv();
		const app = buildApp();
		registerDraftRoutes(app);
		const port = Number(process.env.PORT) || 3001;
		const host = process.env.HOST || "127.0.0.1";
		await app.listen({ port, host });
		app.log.info(`Server listening on http://${host}:${port}`);
		startBackgroundJobs(app);

		process.on("SIGTERM", () => gracefulShutdown("SIGTERM", app));
		process.on("SIGINT", () => gracefulShutdown("SIGINT", app));
	} catch (err) {
		console.error(err);
		process.exit(1);
	}
};

start();
