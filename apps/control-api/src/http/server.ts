import type { FastifyInstance } from "fastify";
import { createControlApiApp } from "./app.js";
import type {
  ControlApiAppOptions,
  ControlApiContainer,
  ControlApiDependencies
} from "./types.js";

export interface ServerListenOptions extends ControlApiAppOptions {
  readonly host?: string;
  readonly port?: number;
}

export async function startControlApiServer(
  dependencies: ControlApiDependencies | ControlApiContainer,
  options: ServerListenOptions = {}
): Promise<{ app: FastifyInstance; close: () => Promise<void>; port: number; host: string }> {
  const app = createControlApiApp(dependencies, options);
  const host = options.host ?? "0.0.0.0";
  const port = options.port ?? 0;

  await app.listen({ host, port });
  const addressInfo = app.server.address();
  const actualPort =
    typeof addressInfo === "object" && addressInfo !== null ? addressInfo.port : port;

  return {
    app,
    close: async () => {
      await app.close();
    },
    port: actualPort,
    host
  };
}
