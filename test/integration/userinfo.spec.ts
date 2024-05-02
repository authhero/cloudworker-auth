import { describe, it, expect } from "vitest";
import { testClient } from "hono/testing";
import { getEnv } from "./helpers/test-client";
import { loginApp } from "../../src/app";
import { AuthorizationResponseType } from "../../src/types";

describe("userinfo", () => {
  it("return the userinfo for a user", async () => {
    const env = await getEnv();
    const loginClient = testClient(loginApp, env);

    const loginResponse = await loginClient.co.authenticate.$post({
      json: {
        client_id: "clientId",
        credential_type: "http://auth0.com/oauth/grant-type/password-realm",
        realm: "Username-Password-Authentication",
        password: "Test1234!",
        username: "foo@example.com",
      },
    });

    const { login_ticket } = await loginResponse.json();

    const tokenResponse = await loginClient.authorize.$get({
      query: {
        auth0Client: "eyJuYW1lIjoiYXV0aDAuanMiLCJ2ZXJzaW9uIjoiOS4yMy4wIn0=",
        client_id: "clientId",
        login_ticket,
        response_type: AuthorizationResponseType.TOKEN_ID_TOKEN,
        redirect_uri: "http://login.example.com",
        state: "state",
        scope: "openid profile email",
        realm: "Username-Password-Authentication",
      },
    });

    expect(tokenResponse.status).toBe(302);
    const redirectUri = new URL(tokenResponse.headers.get("location")!);

    const searchParams = new URLSearchParams(redirectUri.hash.slice(1));
    const token = searchParams.get("access_token");

    expect(token).toBeTypeOf("string");

    const userinfoResponse = await loginClient.userinfo.$get(
      {},
      {
        headers: {
          authorization: `Bearer ${token}`,
        },
      },
    );

    if (userinfoResponse.status !== 200) {
      throw new Error(await userinfoResponse.text());
    }
    expect(userinfoResponse.status).toBe(200);
  });
});
