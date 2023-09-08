import { contextFixture } from "../fixtures";
import { passwordGrant } from "../../src/token-grant-types";
import { GrantType, PasswordGrantTypeParams } from "../../src/types";

describe("passwordGrant", () => {
  it("should pass the audience to the token", async () => {
    const ctx = contextFixture();

    const params: PasswordGrantTypeParams = {
      grant_type: GrantType.Password,
      username: "username",
      password: "password",
      client_id: "clientId",
      audience: "audience",
    };

    const { access_token } = await passwordGrant(ctx.env, params);

    // This is a mock returning the token as a json string
    const accessToken = JSON.parse(access_token);
    expect(accessToken.aud).toBe("audience");
  });
});