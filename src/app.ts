import { Context, Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { Env } from "./types/Env";
import { RegisterRoutes } from "../build/routes";
import swagger from "../build/swagger.json";
import packageJson from "../package.json";
import swaggerUi from "./routes/swagger-ui";
import rotateKeys from "./routes/rotate-keys";
import { serve } from "./routes/login";
import { migrateDown, migrateToLatest } from "./migrate";
import { getDb } from "./services/db";
import loggerMiddleware from "./middlewares/logger";
import renderOauthRedirectHtml from "./routes/oauth2-redirect";

export const app = new Hono<{ Bindings: Env }>();

app.onError((err, ctx) => {
  if (err instanceof HTTPException) {
    // Get the custom response
    return err.getResponse();
  }

  return ctx.text("Server Error", 500);
});

app.use(loggerMiddleware);
app.use(cors());

app.get("/", async () => {
  return new Response(
    JSON.stringify({
      name: packageJson.name,
      version: packageJson.version,
    }),
  );
});

app.get("/spec", async () => {
  return new Response(JSON.stringify(swagger));
});

app.get("/docs", swaggerUi);
app.get("/oauth2-redirect.html", renderOauthRedirectHtml);

// app.post("/migrate-to-latest", async (ctx: Context<Env>) => {
//   try {
//     await migrateToLatest(ctx);
//     return new Response("OK");
//   } catch (err: any) {
//     return new Response(
//       JSON.stringify({
//         message: err.message,
//         cause: err.cause,
//       }),
//       {
//         status: 500,
//         headers: {
//           "content-type": "application/json",
//         },
//       },
//     );
//   }
// });

// app.post("/migrate-down", async (ctx: Context<Env>) => {
//   try {
//     await migrateDown(ctx);
//     return new Response("OK");
//   } catch (err: any) {
//     return new Response(
//       JSON.stringify({
//         message: err.message,
//         cause: err.cause,
//       }),
//       {
//         status: 500,
//         headers: {
//           "content-type": "application/json",
//         },
//       },
//     );
//   }
// });

// app.post("/rotate-keys", async (ctx: Context<Env>) => {
//   await rotateKeys(ctx.env);

//   return new Response("OK");
// });

app.get("/static/:file*", serve);

app.get("/test", async (ctx: Context<{ Bindings: Env }>) => {
  const db = getDb(ctx.env);
  const application = await db
    .selectFrom("applications")
    .selectAll()
    .executeTakeFirst();

  const url = new URL(ctx.req.url);

  return new Response("Test redirect", {
    status: 302,
    headers: {
      location: `/authorize?client_id=${application?.id}&redirect_uri=${url.protocol}//${url.host}/u/info&scope=profile%20email%20openid&state=1234&response_type=code`,
    },
  });
});

app.post("/create-key", async (ctx: Context<{ Bindings: Env }>) => {
  await rotateKeys(ctx.env);

  return new Response("OK");
});

RegisterRoutes(app as unknown as Hono);
