import { Controller } from "@tsoa/runtime";
import { AuthorizationResponseType, AuthParams, Client, Env } from "../types";
import { contentTypes, headers } from "../constants";
import { hexToBase64 } from "../utils/base64";
import { getClient } from "../services/clients";
import { getId } from "../models";
import { setSilentAuthCookies } from "../helpers/silent-auth-cookie";
import { generateCode } from "../helpers/generate-auth-response";
import { RenderLoginContext } from "../templates/render";

export interface SocialAuthState {
  authParams: AuthParams;
  connection: string;
}

export async function socialAuth(
  env: Env,
  controller: Controller,
  client: Client,
  connection: string,
  authParams: AuthParams
) {
  const oauthProvider = client.authProviders.find((p) => p.name === connection);
  if (!oauthProvider) {
    throw new Error("Connection not found");
  }

  const stateId = env.STATE.newUniqueId().toString();
  const stateInstance = env.stateFactory.getInstanceById(stateId);
  await stateInstance.createState.mutate({
    state: JSON.stringify({ authParams, connection }),
  });

  const oauthLoginUrl = new URL(oauthProvider.authorizationEndpoint);
  if (authParams.scope) {
    oauthLoginUrl.searchParams.set("scope", authParams.scope);
  }
  oauthLoginUrl.searchParams.set("state", hexToBase64(stateId));
  // TODO: this should be pointing to the callback url
  oauthLoginUrl.searchParams.set(
    "redirect_uri",
    `${client.loginBaseUrl}callback`
  );
  oauthLoginUrl.searchParams.set("client_id", oauthProvider.clientId);
  oauthLoginUrl.searchParams.set("response_type", "code");
  controller.setHeader(headers.location, oauthLoginUrl.href);
  controller.setStatus(302);
  return `Redirecting to ${connection}`;
}

export interface socialAuthCallbackParams {
  env: Env;
  controller: Controller;
  state: RenderLoginContext;
  code: string;
}

export async function socialAuthCallback({
  env,
  controller,
  state,
  code,
}: socialAuthCallbackParams) {
  const client = await getClient(env, state.authParams.client_id);
  const oauthProvider = client.authProviders.find(
    (p) => p.name === state.connection
  );

  // We need the profile enpdoint to connect the user to the account. Another option would be to unpack the id token..
  if (!oauthProvider || !oauthProvider.profileEndpoint) {
    throw new Error("Connection not found");
  }

  const oauth2Client = env.oauth2ClientFactory.create(
    oauthProvider,
    `${client.loginBaseUrl}callback`,
    state.authParams.scope?.split(" ") || []
  );

  const token = await oauth2Client.exchangeCodeForToken(code);

  const oauth2Profile = await oauth2Client.getUserProfile(token.access_token);

  const userId = getId(client.tenantId, oauth2Profile.email);
  const user = env.userFactory.getInstanceByName(userId);

  await user.patchProfile.mutate({
    email: oauth2Profile.email,
    tenantId: client.tenantId,
    connections: [{ name: oauthProvider.name, profile: oauth2Profile }],
  });

  const sessionId = await setSilentAuthCookies(
    env,
    controller,
    userId,
    state.authParams
  );

  if (!state.authParams.redirect_uri) {
    throw new Error("Redirect URI not defined");
  }

  // TODO: This is quick and dirty.. we should validate the values.
  const redirectUri = new URL(state.authParams.redirect_uri);

  switch (state.authParams.response_type) {
    case AuthorizationResponseType.CODE:
      const code = await generateCode({
        env,
        userId,
        authParams: state.authParams,
        user: {
          email: "dummy@example.com",
        },
        sid: sessionId,
      });
      redirectUri.searchParams.set("code", code);
      if (state.authParams.state) {
        redirectUri.searchParams.set("state", state.authParams.state);
      }
      break;
    default:
      throw new Error("Unsupported response type");
  }

  controller.setStatus(302);
  controller.setHeader(headers.location, redirectUri.href);
  controller.setHeader(headers.contentType, contentTypes.text);

  return "Redirecting";
}
