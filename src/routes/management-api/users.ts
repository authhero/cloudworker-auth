import {
  Controller,
  Get,
  Query,
  Request,
  Route,
  Post,
  Tags,
  Path,
  Header,
  SuccessResponse,
  Body,
  Delete,
  Put,
  Security,
} from "@tsoa/runtime";
import { getDb } from "../../services/db";
import { RequestWithContext } from "../../types/RequestWithContext";
import { NotFoundError } from "../../errors";
import { getId } from "../../models";
import { User } from "../../types/sql/User";
import { Profile } from "../../types";
import {
  UserResponse,
  GetUserResponseWithTotals,
  PostUsersBody,
} from "../../types/auth0/UserResponse";

export interface LinkBodyParams {
  provider?: string;
  connection_id?: string;
  link_with: string;
}

@Route("api/v2")
@Tags("management-api")
// TODO - check with NPM lib auth0/node @ https://github.com/sesamyab/auth0-management-api-demo/ - that this can create the correct token
// ALSO - are we checking these scopes? read:users update:users create:users delete:users
@Security("oauth2managementApi", [""])
export class UsersMgmtController extends Controller {
  @Get("users")
  public async listUsers(
    @Request() request: RequestWithContext,
    @Header("tenant-id") tenantId: string,
    // Auth0
    @Query() page = 0,
    @Query() per_page = 20,
    @Query() include_totals = false,
    @Query() sort?: string,
    @Query() connection?: string,
    @Query() fields?: string,
    @Query() include_fields?: boolean,
    @Query() q?: string,
    @Query() search_engine?: "v1" | "v2" | "v3",
  ): Promise<UserResponse[] | GetUserResponseWithTotals> {
    const { env } = request.ctx;

    const data = await env.data.users.listUsers(tenantId, {
      page,
      perPage: per_page,
      includeTotals: include_totals,
    });

    if (include_totals && data.totals) {
      return {
        ...data.totals,
        users: data.users,
      };
    }
    return data.users;
  }

  @Get("users/{userId}")
  public async getUser(
    @Request() request: RequestWithContext,
    @Path("userId") userId: string,
    @Header("tenant-id") tenantId: string,
  ): Promise<Profile> {
    const { env } = request.ctx;

    const db = getDb(env);
    const dbUser = await db
      .selectFrom("users")
      .where("users.tenant_id", "=", tenantId)
      .where("users.id", "=", userId)
      .select("users.email")
      .executeTakeFirst();

    if (!dbUser) {
      throw new NotFoundError();
    }

    const user = env.userFactory.getInstanceByName(
      getId(tenantId, dbUser.email),
    );

    return user.getProfile.query();
  }

  @Delete("users/{userId}")
  @SuccessResponse(200, "Delete")
  public async deleteUser(
    @Request() request: RequestWithContext,
    @Path("userId") userId: string,
    @Header("tenant-id") tenantId: string,
  ): Promise<Profile> {
    const { env } = request.ctx;

    const db = getDb(env);
    const dbUser = await db
      .selectFrom("users")
      .where("users.tenant_id", "=", tenantId)
      .where("users.id", "=", userId)
      .select("users.email")
      .executeTakeFirst();

    if (!dbUser) {
      throw new NotFoundError();
    }

    const user = env.userFactory.getInstanceByName(
      getId(tenantId, dbUser.email),
    );

    return user.delete.mutate();
  }

  @Get("users-by-email")
  public async getUserByEmail(
    @Request() request: RequestWithContext,
    @Query("email") userEmail: string,
    @Header("tenant-id") tenantId: string,
  ): Promise<Profile> {
    const { env } = request.ctx;

    const db = getDb(env);
    const dbUser = await db
      .selectFrom("users")
      .where("users.tenant_id", "=", tenantId)
      .where("users.email", "=", userEmail)
      .select("users.email")
      .executeTakeFirst();

    if (!dbUser) {
      throw new NotFoundError();
    }

    const user = env.userFactory.getInstanceByName(
      getId(tenantId, dbUser.email),
    );

    return user.getProfile.query();
  }

  @Post("users")
  @SuccessResponse(201, "Created")
  /**
   * Create a new user.
   */
  public async postUser(
    @Request() request: RequestWithContext,
    @Header("tenant-id") tenantId: string,
    @Body()
    user: PostUsersBody,
  ): Promise<UserResponse> {
    const { env } = request.ctx;

    const data = await env.data.users.createUser(tenantId, user);

    return data;
  }

  @Put("users/{userId}")
  public async putUser(
    @Request() request: RequestWithContext,
    @Header("tenant-id") tenantId: string,
    @Body()
    user: Omit<User, "tenant_id" | "created_at" | "modified_at"> &
      Partial<Pick<User, "created_at" | "modified_at">>,
  ): Promise<Profile> {
    const { ctx } = request;

    const userInstance = ctx.env.userFactory.getInstanceByName(
      getId(tenantId, user.email),
    );

    const result: Profile = await userInstance.patchProfile.mutate({
      ...user,
      tenant_id: tenantId,
    });
    return result;
  }

  @Post("users/{userId}/identities")
  public async linkUserAccount(
    @Request() request: RequestWithContext,
    @Header("tenant-id") tenantId: string,
    @Path("userId") userId: string,
    @Body() body: LinkBodyParams,
  ): Promise<Profile> {
    const { env } = request.ctx;

    const db = getDb(env);
    const currentDbUser = await db
      .selectFrom("users")
      .where("users.tenant_id", "=", tenantId)
      .where("users.id", "=", userId)
      .select(["users.email"])
      .executeTakeFirst();

    if (!currentDbUser) {
      throw new NotFoundError("Current user not found");
    }

    const linkedDbUser = await db
      .selectFrom("users")
      .where("users.tenant_id", "=", tenantId)
      .where("users.id", "=", body.link_with)
      .select(["users.email"])
      .executeTakeFirst();

    if (!linkedDbUser) {
      throw new NotFoundError("Linked user not found");
    }

    const currentUser = env.userFactory.getInstanceByName(
      getId(tenantId, currentDbUser.email),
    );

    const linkedUser = env.userFactory.getInstanceByName(
      getId(tenantId, linkedDbUser.email),
    );

    // Link the child account
    await linkedUser.linkToUser.mutate({
      tenantId,
      email: linkedDbUser.email,
      linkWithEmail: currentDbUser.email,
    });

    // Link the parent account
    return currentUser.linkWithUser.mutate({
      tenantId,
      email: currentDbUser.email,
      linkWithEmail: linkedDbUser.email,
    });
  }
}
