import { Env, AuthParams, AuthorizationResponseType, User } from "../types";
import { CodeResponse, TokenResponse } from "../types/Token";
import { ACCESS_TOKEN_EXPIRE_IN_SECONDS } from "../constants";
import { hexToBase64 } from "../utils/base64";
import { TokenFactory } from "../services/token-factory";

export interface GenerateAuthResponseParamsBase {
  env: Env;
  userId: string;
  sid: string;
  state?: string;
  nonce?: string;
  authParams: AuthParams;
}

export interface GenerateAuthResponseParamsForCode
  extends GenerateAuthResponseParamsBase {
  responseType: AuthorizationResponseType.CODE;
  user: User;
}

export interface GenerateAuthResponseParamsForToken
  extends GenerateAuthResponseParamsBase {
  responseType: AuthorizationResponseType.TOKEN;
}

export interface GenerateAuthResponseParamsForIdToken
  extends GenerateAuthResponseParamsBase {
  responseType: AuthorizationResponseType.TOKEN_ID_TOKEN;
  user: User;
}

export async function generateCode({
  env,
  userId,
  state,
  nonce,
  authParams,
  sid,
  user,
}: GenerateAuthResponseParamsForCode) {
  // TODO: replace with the adapter
  const stateId = env.STATE.newUniqueId().toString();
  const stateInstance = env.stateFactory.getInstanceById(stateId);
  await stateInstance.createState.mutate({
    state: JSON.stringify({
      userId,
      authParams,
      nonce,
      state,
      sid,
      user,
    }),
  });

  const codeResponse: CodeResponse = {
    code: hexToBase64(stateId),
    state,
  };

  return codeResponse;
}

export async function generateTokens(
  params:
    | GenerateAuthResponseParamsForToken
    | GenerateAuthResponseParamsForIdToken,
) {
  const { env, authParams, userId, state, responseType, sid, nonce } = params;

  const certificates = await env.data.certificates.listCertificates();
  const certificate = certificates[certificates.length - 1];
  const tokenFactory = new TokenFactory(
    certificate.privateKey,
    certificate.kid,
  );

  const accessToken = await tokenFactory.createAccessToken({
    aud: authParams.audience,
    scope: authParams.scope || "",
    sub: userId,
    // TODO - IMHO we should pass this in here to consistently generate just here
    // sub: `${"tenant_id"}|${userId}`,
    iss: env.ISSUER,
  });

  const tokenResponse: TokenResponse = {
    access_token: accessToken,
    token_type: "Bearer",
    state,
    scope: authParams.scope,
    expires_in: ACCESS_TOKEN_EXPIRE_IN_SECONDS,
  };

  // ID TOKEN
  if (responseType === AuthorizationResponseType.TOKEN_ID_TOKEN) {
    const { user } = params;

    tokenResponse.id_token = await tokenFactory.createIDToken({
      ...user,
      clientId: authParams.client_id,
      userId: userId,
      iss: env.ISSUER,
      sid,
      nonce: nonce || authParams.nonce,
    });
  }

  // REFRESH TOKEN
  // if (authParams.scope?.split(' ').includes('offline_access')) {
  //   const { refresh_token } = await createRefreshToken(params);
  //   tokenResponse.refresh_token = refresh_token;
  // }

  return tokenResponse;
}

export type GenerateAuthResponseParams =
  | GenerateAuthResponseParamsForToken
  | GenerateAuthResponseParamsForIdToken
  | GenerateAuthResponseParamsForCode;

export async function generateAuthResponse(params: GenerateAuthResponseParams) {
  switch (params.responseType) {
    case AuthorizationResponseType.TOKEN:
    case AuthorizationResponseType.TOKEN_ID_TOKEN:
      return generateTokens(params);
    case AuthorizationResponseType.CODE:
      return generateCode(params);
  }
}
