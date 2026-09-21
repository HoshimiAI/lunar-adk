import { createDefaultApp } from "./app";

const app = (await createDefaultApp()).listen(process.env.PORT ? Number(process.env.PORT) : 3000);

console.log(`Lunar Elysia server running at ${app.server?.hostname}:${app.server?.port}`);
