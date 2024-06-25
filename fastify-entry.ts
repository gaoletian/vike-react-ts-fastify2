import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { createTodoHandler } from "./server/create-todo-handler";
import { vikeHandler } from "./server/vike-handler";

import { createRequestAdapter } from "@universal-middleware/express";
import Fastify from "fastify";
import type { RouteHandlerMethod } from "fastify/types/route";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const isProduction = process.env.NODE_ENV === "production";
const root = __dirname;
const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const hmrPort = process.env.HMR_PORT
  ? parseInt(process.env.HMR_PORT, 10)
  : 24678;

interface Middleware<
  Context extends Record<string | number | symbol, unknown>,
> {
  (
    request: Request,
    context: Context,
  ): Response | void | Promise<Response> | Promise<void>;
}

export function handlerAdapter<
  Context extends Record<string | number | symbol, unknown>,
>(handler: Middleware<Context>) {
  const requestAdapter = createRequestAdapter();
  return (async (request, reply) => {
    const config = request.routeOptions.config as unknown as Record<
      string,
      unknown
    >;
    config.context ??= {};
    const response = await handler(
      requestAdapter(request.raw)[0],
      config.context as Context,
    );

    if (response) {
      if (!response.body) {
        // Fastify currently doesn't send a response for body is null.
        // To mimic express behavior, we convert the body to an empty ReadableStream.
        Object.defineProperty(response, "body", {
          value: new ReadableStream({
            start(controller) {
              controller.close();
            },
          }),
          writable: false,
          configurable: true,
        });
      }

      return reply.send(response);
    }
  }) satisfies RouteHandlerMethod;
}

startServer();

async function startServer() {
  const app = Fastify();

  // Avoid pre-parsing body, otherwise it will cause issue with universal handlers
  // This will probably change in the future though, you can follow https://github.com/magne4000/universal-handler for updates
  app.removeAllContentTypeParsers();
  app.addContentTypeParser("*", function (_request, _payload, done) {
    done(null, "");
  });

  await app.register(await import("@fastify/middie"));

  if (isProduction) {
    await app.register(await import("@fastify/static"), {
      root: `${root}/dist/client`,
      wildcard: false,
    });
  } else {
    // Instantiate Vite's development server and integrate its middleware to our server.
    // ⚠️ We should instantiate it *only* in development. (It isn't needed in production
    // and would unnecessarily bloat our server in production.)
    const vite = await import("vite");
    const viteDevMiddleware = (
      await vite.createServer({
        root,
        server: { middlewareMode: true, hmr: { port: hmrPort } },
      })
    ).middlewares;
    app.use(viteDevMiddleware);
  }

  app.post("/api/todo/create", handlerAdapter(createTodoHandler));

  /**
   * Vike route
   *
   * @link {@see https://vike.dev}
   **/
  app.all("/*", handlerAdapter(vikeHandler));

  app.listen(
    {
      port: port,
    },
    () => {
      console.log(`Server listening on http://localhost:${port}`);
    },
  );
}
