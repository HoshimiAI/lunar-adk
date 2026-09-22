import { createRuntime } from "@lunar/adk";
import { createApp } from "./app";
import { greetingPlugin } from "./plugins/greeting-plugin";

const runtime = await createRuntime({ plugins: [greetingPlugin] });
const app = (await createApp(runtime)).listen(process.env.PORT ? Number(process.env.PORT) : 3001);

console.log(`Plugin demo server running at ${app.server?.hostname}:${app.server?.port}`);
