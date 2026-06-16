import type { FastifyReply } from "fastify";

export interface ErrorBody {
	ok: false;
	error: string;
	kind?: string;
}

export function err(
	reply: FastifyReply,
	status: number,
	error: string,
	kind?: string,
): void {
	const body: ErrorBody = { ok: false, error };
	if (kind) body.kind = kind;
	reply.status(status).send(body);
}
