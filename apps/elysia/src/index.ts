import { createDefaultApp } from "./app";

const app = (await createDefaultApp({
  allowUnauthenticated: process.env.LUNAR_ALLOW_UNAUTHENTICATED === "true",
})).listen({
  hostname: process.env.HOST ?? "127.0.0.1",
  port: process.env.PORT ? Number(process.env.PORT) : 3000,
});

console.log(`Lunar Elysia server running at ${app.server?.hostname}:${app.server?.port}`);
