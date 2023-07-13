import {
  Controller,
  Get,
  Patch,
  Post,
  Request,
  Route,
  SuccessResponse,
  Tags,
  Body,
  Path,
} from "@tsoa/runtime";
import { User } from "../../types/sql/User";
import { getDb } from "../../services/db";
import { RequestWithContext } from "../../types/RequestWithContext";
import { NoUserFoundError, NotFoundError } from "../../errors";
import { getId } from "../../models";

@Route("tenants/{tenantId}/users")
@Tags("users")
export class UsersController extends Controller {
  @Get("")
  public async listUsers(
    @Request() request: RequestWithContext,
    @Path("tenantId") tenantId: string
  ): Promise<User[]> {
    const db = getDb(request.ctx.env);
    const users = db
      .selectFrom("users")
      .where("users.tenantId", "=", tenantId)
      .selectAll()
      .execute();

    return users;
  }

  @Get("{userId}")
  public async getUser(
    @Request() request: RequestWithContext,
    @Path("tenantId") tenantId: string,
    @Path("userId") userId: string
  ): Promise<User> {
    const { env } = request.ctx;

    const db = getDb(env);
    const dbUser = await db
      .selectFrom("users")
      .where("users.tenantId", "=", tenantId)
      .where("users.id", "=", userId)
      .select('email')
      .executeTakeFirst();

    if (!dbUser) {
      throw new NotFoundError();
    }

    // Fetch the user from durable object
    const user = env.userFactory.getInstanceByName(
      getId(tenantId, dbUser.email)
    );

    return user.getProfile.query();
  }

  @Patch("{userId}")
  public async updateUser(
    @Request() request: RequestWithContext,
    @Body()
    body: Partial<Omit<User, "id" | "createdAt" | "modifiedAt">> & {
      password?: string;
    },
    @Path("userId") userId: string,
    @Path("tenantId") tenantId: string
  ): Promise<User> {
    const { env } = request.ctx;

    const db = getDb(request.ctx.env);
    const user = await db
      .selectFrom("users")
      .where("users.tenantId", "=", tenantId)
      .select("email")
      .executeTakeFirst();

    if (!user) {
      throw new NoUserFoundError();
    }

    const doId = `${tenantId}|${user.email}`;
    const userInstance = env.userFactory.getInstanceByName(doId);

    if (body.password) {
      await userInstance.setPassword.mutate(body.password);
    }

    return userInstance.getProfile.query();
  }

  @Post("")
  @SuccessResponse(201, "Created")
  public async postUser(
    @Request() request: RequestWithContext,
    @Path("tenantId") tenantId: string,
    @Body()
    user: Omit<User, "tenantId" | "createdAt" | "modifiedAt" | "id"> &
      Partial<Pick<User, "createdAt" | "modifiedAt" | "id">>
  ): Promise<User> {
    const { ctx } = request;

    const doId = `${tenantId}|${user.email}`;
    const userInstance = ctx.env.userFactory.getInstanceByName(doId);

    const result = await userInstance.patchProfile.mutate({
      ...user,
      connections: user.connections || [],
      tenantId,
    });

    return result as User;
  }
}
