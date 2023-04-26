// src/users/usersController.ts
import {
  Body,
  Controller,
  Post,
  Request,
  Route,
  Tags,
  Path,
} from "@tsoa/runtime";
import { RequestWithContext } from "../../types/RequestWithContext";
import { getId, User } from "../../models/User";
import sendEmail from "../../services/email";
import { getDb } from "../../services/db";
import { getClient } from "../../services/clients";
import { nanoid } from "nanoid";
import { User as DbUser } from "../../types/sql";

export interface RegisterUserParams {
  client_id: string;
  client_secret?: string;
  connection: string;
  email: string;
  send?: "link" | "code";
}

export interface ResetPasswordParams {
  client_id?: string;
  connection: string;
  email: string;
}

export interface VerifyEmailParams {
  client_id?: string;
  code: string;
  email: string;
}

export interface RegisterParams {
  email: string;
  password: string;
}

@Route("{clientId}/dbconnection")
@Tags("dbconnection")
export class DbConnectionController extends Controller {
  @Post("register")
  public async registerUser(
    @Body() body: RegisterParams,
    @Request() request: RequestWithContext,
    @Path("clientId") clientId: string
  ): Promise<string> {
    const { ctx } = request;

    const user = User.getInstanceByName(
      ctx.env.USER,
      getId(clientId, body.email)
    );
    // This throws if if fails
    await user.registerPassword.mutate(body.password);

    const dbUser: DbUser = {
      email: body.email,
      clientId,
      // TODO: this id should be generated in the durable object
      id: nanoid(),
      createdAt: new Date().toISOString(),
      modifiedAt: new Date().toISOString(),
    };

    const db = getDb(ctx);
    await db
      .insertInto("users")
      .values(dbUser)
      .returning("id")
      .executeTakeFirstOrThrow();

    return "OK";
  }

  @Post("reset_password")
  public async resetPassword(
    @Body() body: ResetPasswordParams,
    @Request() request: RequestWithContext,
    @Path("clientId") clientId: string
  ): Promise<string> {
    const { ctx } = request;

    const user = User.getInstanceByName(
      ctx.env.USER,
      getId(clientId, body.email)
    );
    const { code } = await user.createPasswordResetCode.mutate();

    const client = await getClient(ctx, clientId);

    const message = `Click this link to reset your password: ${client.loginBaseUrl}/reset-password?email=${body.email}&code=${code}`;
    await sendEmail({
      to: [{ email: body.email, name: "" }],
      from: {
        email: client.senderEmail,
        name: client.senderName,
      },
      content: [
        {
          type: "text/plain",
          value: message,
        },
      ],
      subject: "Reset password",
    });

    return "ok";
  }

  @Post("verify_email")
  public async verifyEmail(
    @Body() body: VerifyEmailParams,
    @Request() request: RequestWithContext,
    @Path("clientId") clientId: string
  ): Promise<string> {
    const { ctx } = request;

    const user = User.getInstanceByName(
      ctx.env.USER,
      getId(clientId, body.email)
    );
    const { code } = await user.validateEmailValidationCode.query(body.code);

    return "ok";
  }
}
