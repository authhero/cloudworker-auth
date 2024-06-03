// TODO - move this file to src/routes/oauth2/login.ts
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { Env, User, AuthorizationResponseType, Client } from "../../types";
import ResetPasswordPage from "../../utils/components/ResetPasswordPage";
import validatePassword from "../../utils/validatePassword";
import {
  getUserByEmailAndProvider,
  getPrimaryUserByEmailAndProvider,
} from "../../utils/users";
import { getClient } from "../../services/clients";
import { HTTPException } from "hono/http-exception";
import i18next from "i18next";
import en from "../../localesLogin2/en/default.json";
import it from "../../localesLogin2/it/default.json";
import nb from "../../localesLogin2/nb/default.json";
import sv from "../../localesLogin2/sv/default.json";
import LoginPage from "../../utils/components/LoginPage";
import LoginWithCodePage from "../../utils/components/LoginWithCodePage";
import LoginEnterCodePage from "../../utils/components/LoginEnterCodePage";
import SignupPage from "../../utils/components/SignUpPage";
import UnverifiedEmail from "../../utils/components/UnverifiedEmailPage";
import MessagePage from "../../utils/components/Message";
import { UniversalLoginSession } from "../../adapters/interfaces/UniversalLoginSession";
import { nanoid } from "nanoid";
import {
  generateAuthData,
  generateAuthResponse,
} from "../../helpers/generate-auth-response";
import { getTokenResponseRedirectUri } from "../../helpers/apply-token-response";
import { Context } from "hono";
import ForgotPasswordPage from "../../utils/components/ForgotPasswordPage";
import generateOTP from "../../utils/otp";
import { sendResetPassword, sendLink, sendCode } from "../../controllers/email";
import { validateCode } from "../../authentication-flows/passwordless";
import { getUsersByEmail } from "../../utils/users";
import userIdGenerate from "../../utils/userIdGenerate";
import { vendorSettingsSchema } from "../../types";
import { sendEmailVerificationEmail } from "../../authentication-flows/passwordless";
import { getSendParamFromAuth0ClientHeader } from "../../utils/getSendParamFromAuth0ClientHeader";
import {
  getPasswordLoginSelectionCookieName,
  SesamyPasswordLoginSelection,
  parsePasswordLoginSelectionCookie,
} from "../../utils/authCookies";
import { setCookie, getCookie } from "hono/cookie";
import { waitUntil } from "../../utils/wait-until";

const DEFAULT_SESAMY_VENDOR = {
  name: "sesamy",
  logoUrl: `https://assets.sesamy.com/static/images/email/sesamy-logo.png`,
  style: {
    primaryColor: "#7D68F4",
    buttonTextColor: "#7D68F4",
    primaryHoverColor: "#7D68F4",
  },
  loginBackgroundImage: "",
  checkoutHideSocial: false,
  supportEmail: "support@sesamy.com",
  supportUrl: "https://support.sesamy.com",
  siteUrl: "https://sesamy.com",
  termsAndConditionsUrl: "https://store.sesamy.com/pages/terms-of-service",
  manageSubscriptionsUrl: "https://account.sesamy.com/manage-subscriptions",
};

async function initJSXRoute(state: string, env: Env) {
  const session = await env.data.universalLoginSessions.get(state);
  if (!session) {
    throw new HTTPException(400, { message: "Session not found" });
  }

  const client = await getClient(env, session.authParams.client_id);
  if (!client) {
    throw new HTTPException(400, { message: "Client not found" });
  }

  const tenant = await env.data.tenants.get(client.tenant_id);
  if (!tenant) {
    throw new HTTPException(400, { message: "Tenant not found" });
  }

  const vendorSettings = await fetchVendorSettings(
    env,
    client.id,
    session.authParams.vendor_id,
  );

  initI18n(tenant.language || "sv");

  return { vendorSettings, client, tenant, session };
}

async function fetchVendorSettings(
  env: Env,
  client_id?: string,
  vendor_id?: string,
) {
  if (!vendor_id && !client_id) {
    return DEFAULT_SESAMY_VENDOR;
  }

  const vendorId = vendor_id || client_id;

  try {
    const vendorSettingsRes = await fetch(
      `${env.API_URL}/profile/vendors/${vendorId}/style`,
    );

    const vendorSettingsRaw = await vendorSettingsRes.json();

    const vendorSettings = vendorSettingsSchema.parse(vendorSettingsRaw);

    return vendorSettings;
  } catch (e) {
    console.error(e);
    return DEFAULT_SESAMY_VENDOR;
  }
}

// duplicated from /passwordless route
const CODE_EXPIRATION_TIME = 30 * 60 * 1000;

function initI18n(lng: string) {
  i18next.init({
    lng,
    resources: {
      en: { translation: en },
      it: { translation: it },
      nb: { translation: nb },
      sv: { translation: sv },
    },
  });
}

async function handleLogin(
  env: Env,
  user: User,
  session: UniversalLoginSession,
  ctx: Context<{ Bindings: Env }>,
  client: Client,
) {
  if (session.authParams.redirect_uri) {
    const responseType =
      session.authParams.response_type ||
      AuthorizationResponseType.TOKEN_ID_TOKEN;

    // these don't exist in authentication_codes
    const {
      vendor_id,
      audience,
      code_challenge_method,
      code_challenge,
      username,
      ...authParams
    } = session.authParams;

    const authResponse = await generateAuthData({
      env,
      tenantId: session.tenant_id,
      userId: user.id,
      sid: nanoid(),
      responseType,
      authParams,
      user,
    });

    const redirectUrl = getTokenResponseRedirectUri(
      authResponse,
      session.authParams,
    );

    return ctx.redirect(redirectUrl.href);
  }

  const vendorSettings = await fetchVendorSettings(
    env,
    client.id,
    session.authParams.vendor_id,
  );

  return ctx.html(
    <MessagePage
      message="You are logged in"
      pageTitle="Logged in"
      vendorSettings={vendorSettings}
    />,
  );
}

export const loginRoutes = new OpenAPIHono<{ Bindings: Env }>()
  // --------------------------------
  // GET /u/login
  // --------------------------------
  .openapi(
    createRoute({
      tags: ["login"],
      method: "get",
      path: "/login",
      request: {
        query: z.object({
          state: z.string().openapi({
            description: "The state parameter from the authorization request",
          }),
          username: z.string(),
        }),
      },
      responses: {
        200: {
          description: "Response",
        },
      },
    }),
    async (ctx) => {
      const { state, username } = ctx.req.valid("query");

      const { env } = ctx;

      const { vendorSettings, client } = await initJSXRoute(state, env);

      setCookie(
        ctx,
        getPasswordLoginSelectionCookieName(client.id),
        SesamyPasswordLoginSelection.password,
        {
          path: "/",
          secure: true,
          httpOnly: true,
          sameSite: "Strict",
          expires: new Date(Date.now() + 1000 * 60 * 60 * 24),
        },
      );

      return ctx.html(
        <LoginPage
          vendorSettings={vendorSettings}
          email={username}
          state={state}
        />,
      );
    },
  )
  // --------------------------------
  // POST /u/login
  // --------------------------------
  .openapi(
    createRoute({
      tags: ["login"],
      method: "post",
      path: "/login",
      request: {
        query: z.object({
          state: z.string().openapi({
            description: "The state parameter from the authorization request",
          }),
          username: z.string(),
        }),
        body: {
          content: {
            "application/x-www-form-urlencoded": {
              schema: z.object({
                password: z.string(),
              }),
            },
          },
        },
      },
      responses: {
        200: {
          description: "Response",
        },
      },
    }),
    // very similar to authenticate + ticket flow
    async (ctx) => {
      const { env } = ctx;
      const { state, username } = ctx.req.valid("query");
      const { password } = ctx.req.valid("form");

      const { vendorSettings, client, session } = await initJSXRoute(
        state,
        env,
      );

      const user = await getUserByEmailAndProvider({
        userAdapter: ctx.env.data.users,
        tenant_id: client.tenant_id,
        email: username,
        provider: "auth2",
      });

      if (!user) {
        return ctx.html(
          <LoginPage
            vendorSettings={vendorSettings}
            email={username}
            error={i18next.t("invalid_password")}
            state={state}
          />,
          400,
        );
      }

      const { valid } = await env.data.passwords.validate(client.tenant_id, {
        user_id: user.id,
        password: password,
      });

      if (!valid) {
        return ctx.html(
          <LoginPage
            vendorSettings={vendorSettings}
            email={username}
            error={i18next.t("invalid_password")}
            state={state}
          />,
          400,
        );
      }

      if (!user.email_verified) {
        await sendEmailVerificationEmail({
          env: ctx.env,
          client,
          user,
        });

        // login2 looks a bit better - https://login2.sesamy.dev/unverified-email
        return ctx.html(
          <UnverifiedEmail vendorSettings={vendorSettings} />,
          400,
        );
      }

      // want to return primary user if different BUT password is linked to auth2 user
      const primaryUser = await getPrimaryUserByEmailAndProvider({
        userAdapter: env.data.users,
        tenant_id: client.tenant_id,
        email: username,
        provider: "auth2",
      });

      if (!primaryUser) {
        // this should never really happen...
        throw new HTTPException(400, { message: "primaryUser User not found" });
      }

      try {
        // Update the user's last login
        await env.data.users.update(client.tenant_id, primaryUser.id, {
          last_login: new Date().toISOString(),
          login_count: user.login_count + 1,
          // This is specific to cloudflare
          last_ip: ctx.req.header("cf-connecting-ip") || "",
        });

        return handleLogin(env, primaryUser, session, ctx, client);
      } catch (err: any) {
        return ctx.html(
          <LoginPage
            vendorSettings={vendorSettings}
            email={username}
            error={err.message}
            state={state}
          />,
          400,
        );
      }
    },
  )
  // --------------------------------
  // GET /u/reset-password
  // --------------------------------
  .openapi(
    createRoute({
      tags: ["login"],
      method: "get",
      path: "/reset-password",
      request: {
        query: z.object({
          state: z.string().openapi({
            description: "The state parameter from the authorization request",
          }),
          code: z.string().openapi({
            description: "The code parameter from the authorization request",
          }),
        }),
      },
      responses: {
        200: {
          description: "Response",
        },
      },
    }),
    async (ctx) => {
      const { state } = ctx.req.valid("query");

      const { env } = ctx;

      const { vendorSettings, session } = await initJSXRoute(state, env);

      if (!session.authParams.username) {
        throw new HTTPException(400, { message: "Username required" });
      }

      return ctx.html(
        <ResetPasswordPage
          vendorSettings={vendorSettings}
          email={session.authParams.username}
        />,
      );
    },
  )
  // --------------------------------
  // POST /u/reset-password
  // --------------------------------
  .openapi(
    createRoute({
      tags: ["login"],
      method: "post",
      path: "/reset-password",
      request: {
        query: z.object({
          state: z.string().openapi({
            description: "The state parameter from the authorization request",
          }),
          code: z.string().openapi({
            description: "The code parameter from the authorization request",
          }),
        }),
        body: {
          content: {
            "application/x-www-form-urlencoded": {
              schema: z.object({
                password: z.string(),
                "re-enter-password": z.string(),
              }),
            },
          },
        },
      },
      responses: {
        200: {
          description: "Response",
        },
      },
    }),
    async (ctx) => {
      const { state, code } = ctx.req.valid("query");
      const { password, "re-enter-password": reEnterPassword } =
        ctx.req.valid("form");

      const { env } = ctx;

      const { vendorSettings, client, session } = await initJSXRoute(
        state,
        env,
      );

      if (!session.authParams.username) {
        throw new HTTPException(400, { message: "Username required" });
      }

      if (password !== reEnterPassword) {
        return ctx.html(
          <ResetPasswordPage
            error={i18next.t("create_account_passwords_didnt_match")}
            vendorSettings={vendorSettings}
            email={session.authParams.username}
          />,
          400,
        );
      }

      if (!validatePassword(password)) {
        return ctx.html(
          <ResetPasswordPage
            error={i18next.t("create_account_weak_password")}
            vendorSettings={vendorSettings}
            email={session.authParams.username}
          />,
          400,
        );
      }

      // Note! we don't use the primary user here. Something to be careful of
      // this means the primary user could have a totally different email address
      const user = await getUserByEmailAndProvider({
        userAdapter: env.data.users,
        tenant_id: client.tenant_id,
        email: session.authParams.username,
        provider: "auth2",
      });

      if (!user) {
        throw new HTTPException(400, { message: "User not found" });
      }

      try {
        const codes = await env.data.codes.list(client.tenant_id, user.id);
        const foundCode = codes.find((storedCode) => storedCode.code === code);

        if (!foundCode) {
          // surely we should check this on the GET rather than have the user waste time entering a new password?
          // THEN we can assume here it works and throw a hono exception if it doesn't... because it's an issue with our system
          // ALTHOUGH the user could have taken a long time to enter the password...
          return ctx.html(
            <ResetPasswordPage
              error="Code not found or expired"
              vendorSettings={vendorSettings}
              email={session.authParams.username}
            />,
            400,
          );
        }

        await env.data.passwords.update(client.tenant_id, {
          user_id: user.id,
          password,
        });

        // we could do this on the GET...
        if (!user.email_verified) {
          await env.data.users.update(client.tenant_id, user.id, {
            email_verified: true,
          });
        }
      } catch (err) {
        // seems like we should not do this catch... try and see what happens
        return ctx.html(
          <ResetPasswordPage
            error="The password could not be reset"
            vendorSettings={vendorSettings}
            email={session.authParams.username}
          />,
          400,
        );
      }

      return ctx.html(
        <MessagePage
          message={i18next.t("password_has_been_reset")}
          pageTitle={i18next.t("password_has_been_reset_title")}
          vendorSettings={vendorSettings}
        />,
      );
    },
  )
  // --------------------------------
  // GET /u/forgot-password
  // --------------------------------
  .openapi(
    createRoute({
      tags: ["login"],
      method: "get",
      path: "/forgot-password",
      request: {
        query: z.object({
          state: z.string().openapi({
            description: "The state parameter from the authorization request",
          }),
        }),
      },
      responses: {
        200: {
          description: "Response",
        },
      },
    }),
    async (ctx) => {
      const { state } = ctx.req.valid("query");

      const { env } = ctx;

      const { vendorSettings } = await initJSXRoute(state, env);

      return ctx.html(<ForgotPasswordPage vendorSettings={vendorSettings} />);
    },
  )
  // -------------------------------
  // POST /u/forgot-password
  // -------------------------------
  .openapi(
    createRoute({
      tags: ["login"],
      method: "post",
      path: "/forgot-password",
      request: {
        query: z.object({
          state: z.string().openapi({
            description: "The state parameter from the authorization request",
          }),
        }),
        body: {
          content: {
            "application/x-www-form-urlencoded": {
              schema: z.object({
                username: z.string(),
              }),
            },
          },
        },
      },
      responses: {
        200: {
          description: "Response",
        },
      },
    }),
    async (ctx) => {
      const { state } = ctx.req.valid("query");
      const { username } = ctx.req.valid("form");

      const { env } = ctx;

      const { vendorSettings, client, session } = await initJSXRoute(
        state,
        env,
      );

      if (session.authParams.username !== username) {
        session.authParams.username = username;
        await env.data.universalLoginSessions.update(session.id, session);
      }

      const user = await getUserByEmailAndProvider({
        userAdapter: env.data.users,
        tenant_id: client.tenant_id,
        email: username,
        provider: "auth2",
      });

      if (user) {
        const code = generateOTP();

        await env.data.codes.create(client.tenant_id, {
          id: nanoid(),
          code,
          type: "password_reset",
          user_id: user.id,
          created_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + CODE_EXPIRATION_TIME).toISOString(),
        });

        // Get typescript errors here but works on the mgmt api users route...
        // ctx.set("log", `Code: ${code}`);

        await sendResetPassword(env, client, username, code, state);
      } else {
        console.log("User not found");
      }

      return ctx.html(
        <MessagePage
          message={i18next.t("forgot_password_email_sent")}
          pageTitle={i18next.t("forgot_password_title")}
          vendorSettings={vendorSettings}
        />,
      );
    },
  )
  // --------------------------------
  // GET /u/code
  // --------------------------------
  .openapi(
    createRoute({
      tags: ["login"],
      method: "get",
      path: "/code",
      request: {
        query: z.object({
          state: z.string().openapi({
            description: "The state parameter from the authorization request",
          }),
        }),
      },
      responses: {
        200: {
          description: "Response",
        },
      },
    }),
    async (ctx) => {
      const { state } = ctx.req.valid("query");

      const { env } = ctx;
      const { vendorSettings, session } = await initJSXRoute(state, env);

      return ctx.html(
        <LoginWithCodePage vendorSettings={vendorSettings} session={session} />,
      );
    },
  )
  // --------------------------------
  // POST /u/code
  // --------------------------------
  .openapi(
    createRoute({
      tags: ["login"],
      method: "post",
      path: "/code",
      request: {
        query: z.object({
          state: z.string().openapi({
            description: "The state parameter from the authorization request",
          }),
        }),
        body: {
          content: {
            "application/x-www-form-urlencoded": {
              schema: z.object({
                username: z.string().transform((u) => u.toLowerCase()),
              }),
            },
          },
        },
      },
      responses: {
        200: {
          description: "Response",
        },
      },
    }),
    async (ctx) => {
      const { state } = ctx.req.valid("query");
      // backwards compatible to maintain pasted code
      const params = ctx.req.valid("form");

      const { env } = ctx;
      const { client, session } = await initJSXRoute(state, env);

      // Add the username to the state
      session.authParams.username = params.username;
      await env.data.universalLoginSessions.update(session.id, session);

      const passwordLoginSelection =
        parsePasswordLoginSelectionCookie(
          getCookie(ctx, getPasswordLoginSelectionCookieName(client.id)),
        ) || SesamyPasswordLoginSelection.code;

      if (passwordLoginSelection === SesamyPasswordLoginSelection.password) {
        return ctx.redirect(
          `/u/login?state=${state}&username=${params.username}`,
        );
      }

      const code = generateOTP();

      // fields in universalLoginSessions don't match fields in OTP
      const {
        audience,
        code_challenge_method,
        code_challenge,
        username,
        vendor_id,
        ...otpAuthParams
      } = session.authParams;

      await env.data.OTP.create({
        id: nanoid(),
        code,
        // is this a reasonable assumption?
        email: params.username,
        client_id: session.authParams.client_id,
        send: "code",
        authParams: otpAuthParams,
        tenant_id: client.tenant_id,
        created_at: new Date(),
        expires_at: new Date(Date.now() + CODE_EXPIRATION_TIME),
      });

      // request.ctx.set("log", `Code: ${code}`);

      const sendType = getSendParamFromAuth0ClientHeader(session.auth0Client);

      if (sendType === "link") {
        const magicLink = new URL(env.ISSUER);
        magicLink.pathname = "passwordless/verify_redirect";
        if (session.authParams.scope) {
          magicLink.searchParams.set("scope", session.authParams.scope);
        }
        if (session.authParams.response_type) {
          magicLink.searchParams.set(
            "response_type",
            session.authParams.response_type,
          );
        }
        if (session.authParams.redirect_uri) {
          magicLink.searchParams.set(
            "redirect_uri",
            session.authParams.redirect_uri,
          );
        }
        if (session.authParams.audience) {
          magicLink.searchParams.set("audience", session.authParams.audience);
        }
        if (session.authParams.state) {
          magicLink.searchParams.set("state", session.authParams.state);
        }
        if (session.authParams.nonce) {
          magicLink.searchParams.set("nonce", session.authParams.nonce);
        }

        magicLink.searchParams.set("connection", "email");
        magicLink.searchParams.set("client_id", session.authParams.client_id);
        magicLink.searchParams.set("email", session.authParams.username);
        magicLink.searchParams.set("verification_code", code);
        magicLink.searchParams.set("nonce", "nonce");

        waitUntil(
          ctx,
          sendLink(env, client, params.username, code, magicLink.href),
        );
      } else {
        waitUntil(ctx, sendCode(env, client, params.username, code));
      }

      return ctx.redirect(
        `/u/enter-code?state=${state}&username=${params.username}`,
      );
    },
  )
  // --------------------------------
  // GET /u/enter-code
  // --------------------------------
  .openapi(
    createRoute({
      tags: ["login"],
      method: "get",
      path: "/enter-code",
      request: {
        query: z.object({
          state: z.string().openapi({
            description: "The state",
          }),
        }),
      },
      responses: {
        200: {
          description: "Response",
        },
      },
    }),
    async (ctx) => {
      const { state } = ctx.req.valid("query");

      const { env } = ctx;
      const { vendorSettings, session, client } = await initJSXRoute(
        state,
        env,
      );

      setCookie(
        ctx,
        getPasswordLoginSelectionCookieName(client.id),
        SesamyPasswordLoginSelection.code,
        {
          path: "/",
          secure: true,
          httpOnly: true,
          sameSite: "Strict",
          expires: new Date(Date.now() + 1000 * 60 * 60 * 24),
        },
      );

      if (!session.authParams.username) {
        throw new HTTPException(400, {
          message: "Username not found in state",
        });
      }

      return ctx.html(
        <LoginEnterCodePage
          vendorSettings={vendorSettings}
          email={session.authParams.username}
          state={state}
          env={env}
          client={client}
        />,
      );
    },
  )
  // --------------------------------
  // POST /u/enter-code
  // --------------------------------
  .openapi(
    createRoute({
      tags: ["login"],
      method: "post",
      path: "/enter-code",
      request: {
        query: z.object({
          state: z.string().openapi({
            description: "The state",
          }),
        }),
        body: {
          content: {
            "application/x-www-form-urlencoded": {
              schema: z.object({
                code: z.string(),
              }),
            },
          },
        },
      },
      responses: {
        200: {
          description: "Response",
        },
      },
    }),
    async (ctx) => {
      const { state } = ctx.req.valid("query");
      const { code } = ctx.req.valid("form");

      const { env } = ctx;

      const { vendorSettings, session, client } = await initJSXRoute(
        state,
        env,
      );

      if (!session.authParams.username) {
        throw new HTTPException(400, {
          message: "Username not found in state",
        });
      }

      try {
        const user = await validateCode(env, {
          client_id: session.authParams.client_id,
          email: session.authParams.username,
          verification_code: code,
        });

        return generateAuthResponse({
          env,
          tenantId: session.tenant_id,
          userId: user.id,
          sid: nanoid(),
          responseType:
            session.authParams.response_type ||
            AuthorizationResponseType.TOKEN_ID_TOKEN,
          authParams: session.authParams,
          user,
        });
      } catch (err) {
        return ctx.html(
          <LoginEnterCodePage
            vendorSettings={vendorSettings}
            error={i18next.t("Wrong email or verification code.")}
            email={session.authParams.username}
            state={state}
            env={env}
            client={client}
          />,
          400,
        );
      }
    },
  )
  // --------------------------------
  // GET /u/signup
  // --------------------------------
  .openapi(
    createRoute({
      tags: ["login"],
      method: "get",
      path: "/signup",
      request: {
        query: z.object({
          state: z.string().openapi({
            description: "The state parameter from the authorization request",
          }),
          username: z.string().optional(),
        }),
      },
      responses: {
        200: {
          description: "Response",
        },
      },
    }),
    async (ctx) => {
      const { state, username } = ctx.req.valid("query");
      const { env } = ctx;
      const { vendorSettings } = await initJSXRoute(state, env);

      return ctx.html(
        <SignupPage vendorSettings={vendorSettings} email={username} />,
      );
    },
  )
  // --------------------------------
  // POST /u/signup
  // --------------------------------
  .openapi(
    createRoute({
      tags: ["login"],
      method: "post",
      path: "/signup",
      request: {
        query: z.object({
          state: z.string().openapi({
            description: "The state parameter from the authorization request",
          }),
        }),
        body: {
          content: {
            "application/x-www-form-urlencoded": {
              schema: z.object({
                username: z.string().transform((u) => u.toLowerCase()),
                password: z.string(),
                // TODO - something like this
                // "re-enter-password": z.string(),
              }),
            },
          },
        },
      },
      responses: {
        200: {
          description: "Response",
        },
      },
    }),
    // very similar to dbconnections/signup
    async (ctx) => {
      const { state } = ctx.req.valid("query");
      const loginParams = ctx.req.valid("form");
      const { env } = ctx;

      const { vendorSettings, client, session } = await initJSXRoute(
        state,
        env,
      );

      if (!validatePassword(loginParams.password)) {
        return ctx.html(
          <SignupPage
            vendorSettings={vendorSettings}
            error={i18next.t("create_account_weak_password")}
            email={loginParams.username}
          />,
          400,
        );
      }

      if (session.authParams.username !== loginParams.username) {
        session.authParams.username = loginParams.username;
        await env.data.universalLoginSessions.update(session.id, session);
      }

      try {
        const existingUser = await getPrimaryUserByEmailAndProvider({
          userAdapter: ctx.env.data.users,
          tenant_id: client.tenant_id,
          email: loginParams.username,
          provider: "auth2",
        });

        if (existingUser) {
          throw new HTTPException(400, { message: "Invalid sign up" });
        }

        const newUser = await ctx.env.data.users.create(client.tenant_id, {
          id: `auth2|${userIdGenerate()}`,
          email: loginParams.username,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          email_verified: false,
          provider: "auth2",
          connection: "Username-Password-Authentication",
          is_social: false,
          login_count: 0,
        });

        await env.data.passwords.create(client.tenant_id, {
          user_id: newUser.id,
          password: loginParams.password,
        });

        await sendEmailVerificationEmail({
          env: ctx.env,
          client,
          user: newUser,
        });

        return ctx.html(
          <MessagePage
            message={i18next.t("validate_email_body")}
            pageTitle={i18next.t("validate_email_title")}
            vendorSettings={vendorSettings}
          />,
        );
      } catch (err: any) {
        const vendorSettings = await fetchVendorSettings(
          env,
          client.id,
          session.authParams.vendor_id,
        );
        return ctx.html(
          <SignupPage
            vendorSettings={vendorSettings}
            error={err.message}
            email={loginParams.username}
          />,
          400,
        );
      }
    },
  )
  // --------------------------------
  // GET /u/validate-email
  // --------------------------------
  .openapi(
    createRoute({
      tags: ["login"],
      method: "get",
      path: "/validate-email",
      request: {
        query: z.object({
          state: z.string().openapi({
            description: "The state parameter from the authorization request",
          }),
          code: z.string().openapi({
            description: "The code parameter from the authorization request",
          }),
        }),
      },
      responses: {
        200: {
          description: "Response",
        },
      },
    }),
    async (ctx) => {
      const { state, code } = ctx.req.valid("query");

      const { env } = ctx;

      const { client, session, vendorSettings } = await initJSXRoute(
        state,
        env,
      );

      const email = session.authParams.username;
      if (!email) {
        throw new HTTPException(400, {
          message: "Username not found in state",
        });
      }

      const user = await getUserByEmailAndProvider({
        userAdapter: env.data.users,
        tenant_id: client.tenant_id,
        email,
        provider: "auth2",
      });
      if (!user) {
        throw new HTTPException(500, { message: "No user found" });
      }

      const codes = await env.data.codes.list(client.tenant_id, user.id);
      const foundCode = codes.find((storedCode) => storedCode.code === code);

      if (!foundCode) {
        throw new HTTPException(400, { message: "Code not found or expired" });
      }

      await env.data.users.update(client.tenant_id, user.id, {
        email_verified: true,
      });

      const usersWithSameEmail = await getUsersByEmail(
        env.data.users,
        client.tenant_id,
        email,
      );
      const usersWithSameEmailButNotUsernamePassword =
        usersWithSameEmail.filter((user) => user.provider !== "auth2");

      if (usersWithSameEmailButNotUsernamePassword.length > 0) {
        const primaryUsers = usersWithSameEmailButNotUsernamePassword.filter(
          (user) => !user.linked_to,
        );

        // these cases are currently not handled! if we think they're edge cases and we release this, we should at least inform datadog!
        if (primaryUsers.length > 1) {
          console.error("More than one primary user found for email", email);
        }

        if (primaryUsers.length === 0) {
          console.error("No primary user found for email", email);
          // so here we should ... hope there is only one usersWithSameEmailButNotUsernamePassword
          // and then follow that linked_to chain?
        }

        // now actually link this username-password user to the primary user
        if (primaryUsers.length === 1) {
          await env.data.users.update(client.tenant_id, user.id, {
            linked_to: primaryUsers[0].id,
          });
        }
      }

      return ctx.html(
        <MessagePage
          message={i18next.t("email_validated")}
          pageTitle={i18next.t("email_validated")}
          vendorSettings={vendorSettings}
        />,
      );
    },
  )

  // --------------------------------
  // GET /u/info
  // --------------------------------
  .openapi(
    createRoute({
      tags: ["login"],
      method: "get",
      path: "/info",
      request: {
        query: z.object({
          state: z.string().openapi({
            description: "The state parameter from the authorization request",
          }),
          code: z.string().openapi({
            description: "The code parameter from the authorization request",
          }),
        }),
      },
      responses: {
        200: {
          description: "Response",
        },
      },
    }),

    async (ctx) => {
      const vendorSettings = await fetchVendorSettings(ctx.env);

      return ctx.html(
        <MessagePage
          message="Not implemented"
          pageTitle="User info"
          vendorSettings={vendorSettings}
        />,
      );
    },
  );
