import { describe, expect, it } from "@jest/globals";
import {
  AuthorizationResponseMode,
  AuthorizationResponseType,
  CodeChallengeMethod,
} from "../../src/types";
import { contextFixture, controllerFixture } from "../fixtures";

import { universalAuth } from "../../src/authentication-flows";
import { headers } from "../../src/constants";

describe("universalAuth", () => {
  it("should redirect to login using and packing the authParams in the state", async () => {
    // https://example.com/authorize?
    //   client_id=0N0wUHXFl0TMTY2L9aDJYvwX7Xy84HkW&
    //   scope=openid+profile+email&
    //   redirect_uri=http%3A%2F%2Flocalhost%3A3000&
    //   response_type=code&
    //   response_mode=query&
    //   state=OE5oUVR4Y0NlMjR4fm9hVDBFaUVxbGZSWXVIUFU4VktFOElFcG11SWo1bw%3D%3D&
    //   nonce=Ykk2M0JNa2E1WnM5TUZwX2UxUjJtV2VITTlvbktGNnhCb1NmZG1idEJBdA%3D%3D&
    //   code_challenge=4OR7xDlggCgZwps3XO2AVaUXEB82O6xPQBkJIGzkvww&
    //   code_challenge_method=S256&
    //   auth0Client=eyJuYW1lIjoiYXV0aDAtcmVhY3QiLCJ2ZXJzaW9uIjoiMi4wLjEifQ%3D%3D
    const ctx = contextFixture();
    const controller = controllerFixture();

    await universalAuth({
      env: ctx.env,
      controller,
      authParams: {
        redirect_uri: "http://localhost:3000",
        client_id: "0N0wUHXFl0TMTY2L9aDJYvwX7Xy84HkW",
        nonce: "Ykk2M0JNa2E1WnM5TUZwX2UxUjJtV2VITTlvbktGNnhCb1NmZG1idEJBdA==&",
        response_type: AuthorizationResponseType.CODE,
        response_mode: AuthorizationResponseMode.QUERY,
        scope: "openid profile email",
        code_challenge_method: CodeChallengeMethod.S265,
        code_challenge: "4OR7xDlggCgZwps3XO2AVaUXEB82O6xPQBkJIGzkvww",
      },
    });

    // The state is stored in a durable object
    expect(controller.getHeader(headers.location)).toBe(
      "/u/login?state=AAAAAA4",
    );
  });
});
