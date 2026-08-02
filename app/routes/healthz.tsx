import db from "../db.server";

// Fly health check (ARCHITECTURE §6): DB ping included, gates rollouts.
export const loader = async () => {
  try {
    await db.$queryRaw`SELECT 1`;
    return new Response("ok", { status: 200 });
  } catch {
    return new Response("db unreachable", { status: 503 });
  }
};
