import { Controller } from "@tsoa/runtime";
import { AuthParams, Client, Env } from "../types";
import { contentTypes, headers } from "../constants";
import { decode, encode } from "../utils/base64";
import { Context } from "cloudworker-router";
import { getClient } from "../services/clients";
import { OAuth2Client } from "../services/oauth2-client";
import { getId, User } from "../models";
import { setSilentAuthCookies } from "../helpers/silent-auth-cookie";

export interface SocialAuthState {
  authParams: AuthParams;
  connection: string;
}

export async function socialAuth(
  controller: Controller,
  client: Client,
  connection: string,
  authParams: AuthParams
) {
  const oauthProvider = client.oauthProviders.find(
    (p) => p.name === connection
  );
  if (!oauthProvider) {
    throw new Error("Connection not found");
  }

  const state: SocialAuthState = {
    authParams,
    connection,
  };

  const encodedSocialAuthState = encode(JSON.stringify(state));

  const oauthLoginUrl = new URL(oauthProvider.authorizationEndpoint);
  if (authParams.scope) {
    oauthLoginUrl.searchParams.set("scope", authParams.scope);
  }
  oauthLoginUrl.searchParams.set("state", encodedSocialAuthState);
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

export async function socialAuthCallback(
  ctx: Context<Env>,
  controller: Controller,
  state: SocialAuthState,
  code: string
) {
  const client = await getClient(ctx, state.authParams.clientId);
  if (!client) {
    throw new Error("Client not found");
  }

  const oauthProvider = client.oauthProviders.find(
    (p) => p.name === state.connection
  );

  // We need the profile enpdoint to connect the user to the account. Another option would be to unpack the id token..
  if (!oauthProvider || !oauthProvider.profileEndpoint) {
    throw new Error("Connection not found");
  }

  const oauth2Client = new OAuth2Client(
    oauthProvider,
    `${client.loginBaseUrl}callback`,
    state.authParams.scope?.split(" ") || []
  );

  const token = await oauth2Client.exchangeCodeForToken(code);

  const profile = await oauth2Client.getUserProfile(token.access_token);

  const userId = getId(state.authParams.clientId, profile.email);
  const user = User.getInstanceByName(ctx.env.USER, userId);

  await user.patchProfile.mutate({
    connection: oauthProvider.name,
    profile,
  });

  await setSilentAuthCookies(ctx, controller, userId, state.authParams.scope);

  // TODO: This is quick and dirty.. we should validate the values.
  const redirectUri = new URL(state.authParams.redirectUri);

  controller.setStatus(302);
  controller.setHeader(headers.location, redirectUri.href);
  controller.setHeader(headers.contentType, contentTypes.text);

  return "Redirecting";
}
