import { HTTPException } from "hono/http-exception";
import { Env, Var } from "../types";
import userIdGenerate from "../utils/userIdGenerate";
import { getClient } from "../services/clients";
import {
  getPrimaryUserByEmail,
  getPrimaryUserByEmailAndProvider,
} from "../utils/users";
import { nanoid } from "nanoid";
import generateOTP from "../utils/otp";
import {
  CODE_EXPIRATION_TIME,
  UNIVERSAL_AUTH_SESSION_EXPIRES_IN_SECONDS,
} from "../constants";
import {
  sendCode,
  sendLink,
  sendValidateEmailAddress,
} from "../controllers/email";
import { waitUntil } from "../utils/wait-until";
import { Context } from "hono";
import { createLogMessage } from "../utils/create-log-message";
import {
  AuthParams,
  Client,
  LogTypes,
  Login,
  User,
} from "@authhero/adapter-interfaces";
import { preUserSignupHook } from "../hooks";
import { SendType } from "../utils/getSendParamFromAuth0ClientHeader";

interface LoginParams {
  client_id: string;
  email: string;
  verification_code: string;
  ip?: string;
}

export async function validateCode(
  ctx: Context<{ Bindings: Env; Variables: Var }>,
  params: LoginParams,
): Promise<User> {
  const { env } = ctx;

  const client = await getClient(env, params.client_id);

  const otps = await env.data.OTP.list(client.tenant.id, params.email);
  const otp = otps.find((otp) => otp.code === params.verification_code);

  if (!otp) {
    throw new HTTPException(403, { message: "Code not found or expired" });
  }

  // TODO: disable for now
  // await env.data.OTP.remove(client.tenant.id, otp.id);

  const emailUser = await getPrimaryUserByEmailAndProvider({
    userAdapter: env.data.users,
    tenant_id: client.tenant.id,
    email: params.email,
    provider: "email",
  });

  if (emailUser) {
    return emailUser;
  }

  const user = await env.data.users.create(client.tenant.id, {
    user_id: `email|${userIdGenerate()}`,
    email: params.email,
    name: params.email,
    provider: "email",
    connection: "email",
    email_verified: true,
    last_ip: ctx.req.header("x-real-ip"),
    login_count: 1,
    last_login: new Date().toISOString(),
    is_social: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  ctx.set("userId", user.user_id);

  const log = createLogMessage(ctx, {
    type: LogTypes.SUCCESS_SIGNUP,
    description: "Successful signup",
  });

  waitUntil(ctx, env.data.logs.create(client.tenant.id, log));

  return user;
}

// this is not inside src/controllers/email/sendValidateEmailAddress
//  because we're mocking all that for the tests!
// We probably shouldn't do this and instead only mock the lowest level sendEmail function
// but then -> we don't have access to the templates in the bun tests...
// can we mock templates? or even properly use them?

interface sendEmailVerificationEmailParams {
  env: Env;
  client: Client;
  user: User;
  authParams?: AuthParams;
}

export async function sendEmailVerificationEmail({
  env,
  client,
  user,
  authParams: authParamsInitial,
}: sendEmailVerificationEmailParams) {
  const authParams: AuthParams = {
    ...authParamsInitial,
    client_id: client.id,
    username: user.email,
  };

  const login: Login = {
    login_id: nanoid(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    expires_at: new Date(
      Date.now() + UNIVERSAL_AUTH_SESSION_EXPIRES_IN_SECONDS * 1000,
    ).toISOString(),
    authParams,
  };

  await env.data.logins.create(client.tenant.id, login);

  const state = login.login_id;

  const code_id = generateOTP();

  await env.data.codes.create(client.tenant.id, {
    code_id,
    code_type: "email_verification",
    login_id: login.login_id,
    expires_at: new Date(Date.now() + CODE_EXPIRATION_TIME).toISOString(),
  });

  await sendValidateEmailAddress(env, client, user.email, code_id, state);
}

interface sendOtpEmailParams {
  ctx: Context<{ Bindings: Env; Variables: Var }>;
  client: Client;
  authParams: AuthParams;
  sendType: SendType;
}

export async function sendOtpEmail({
  ctx,
  client,
  authParams,
  sendType,
}: sendOtpEmailParams) {
  const { env } = ctx;

  if (!authParams.username) {
    throw new HTTPException(400, { message: "Missing username" });
  }

  const user = await getPrimaryUserByEmail({
    userAdapter: env.data.users,
    tenant_id: client.tenant.id,
    email: authParams.username,
  });
  if (user) {
    ctx.set("userId", user.user_id);
  }

  if (!user) {
    try {
      await preUserSignupHook(ctx, client, ctx.env.data, authParams.username);
    } catch (err) {
      const log = createLogMessage(ctx, {
        type: LogTypes.FAILED_SIGNUP,
        description: "Public signup is disabled",
      });

      await ctx.env.data.logs.create(client.tenant.id, log);

      throw new HTTPException(403, {
        message: "Public signup is disabled",
      });
    }
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
  } = authParams;

  await env.data.OTP.create(client.tenant.id, {
    id: nanoid(),
    code,
    email: authParams.username,
    send: "code",
    authParams: otpAuthParams,
    expires_at: new Date(Date.now() + CODE_EXPIRATION_TIME).toISOString(),
  });

  if (sendType === "link") {
    waitUntil(
      ctx,
      sendLink(ctx, client, authParams.username, code, authParams),
    );
  } else {
    waitUntil(ctx, sendCode(ctx, client, authParams.username, code));
  }
}
