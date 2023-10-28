import {
  Controller,
  Get,
  Post,
  Patch,
  Path,
  Put,
  Request,
  Route,
  Tags,
  Body,
  SuccessResponse,
  Security,
  Delete,
  Header,
} from "@tsoa/runtime";
import { nanoid } from "nanoid";

import { getDb } from "../../services/db";
import { RequestWithContext } from "../../types/RequestWithContext";
import { SqlConnection } from "../../types/sql";
import { updateTenantClientsInKV } from "../../hooks/update-client";
import { headers } from "../../constants";
import { executeQuery } from "../../helpers/sql";

@Route("tenants/{tenantId}/connections")
@Tags("connections")
export class ConnectionsController extends Controller {
  @Get("")
  @Security("oauth2managementApi", [""])
  public async listConnections(
    @Request() request: RequestWithContext,
    @Path("tenantId") tenantId: string,
    @Header("range") rangeRequest?: string,
  ): Promise<SqlConnection[]> {
    const { ctx } = request;

    const db = getDb(ctx.env);
    const query = db
      .selectFrom("connections")
      .where("connections.tenant_id", "=", tenantId);

    const { data, range } = await executeQuery(query, rangeRequest);

    if (range) {
      console.log("header", range);
      this.setHeader(headers.contentRange, range);
    }

    return data;
  }

  @Get("{id}")
  @Security("oauth2managementApi", [""])
  public async getConnection(
    @Request() request: RequestWithContext,
    @Path("id") id: string,
    @Path("tenantId") tenantId: string,
  ): Promise<SqlConnection | string> {
    const { ctx } = request;

    const db = getDb(ctx.env);
    const connection = await db
      .selectFrom("connections")
      .where("connections.tenant_id", "=", tenantId)
      .where("connections.id", "=", id)
      .selectAll()
      .executeTakeFirst();

    if (!connection) {
      this.setStatus(404);
      return "Not found";
    }

    return connection;
  }

  @Delete("{id}")
  @Security("oauth2managementApi", [""])
  public async deleteConnection(
    @Request() request: RequestWithContext,
    @Path("id") id: string,
    @Path("tenantId") tenantId: string,
  ): Promise<string> {
    const { env } = request.ctx;

    const db = getDb(env);
    await db
      .deleteFrom("connections")
      .where("connections.tenant_id", "=", tenantId)
      .where("connections.id", "=", id)
      .execute();

    await updateTenantClientsInKV(env, tenantId);

    return "OK";
  }

  @Patch("{id}")
  @Security("oauth2managementApi", [""])
  public async patchConnection(
    @Request() request: RequestWithContext,
    @Path("id") id: string,
    @Path("tenantId") tenantId: string,
    @Body()
    body: Partial<
      Omit<SqlConnection, "id" | "tenant_id" | "created_at" | "updated_at">
    >,
  ) {
    const { env } = request.ctx;

    const db = getDb(env);
    const connection = {
      ...body,
      tenantId,
      updated_at: new Date().toISOString(),
    };

    const results = await db
      .updateTable("connections")
      .set(connection)
      .where("id", "=", id)
      .execute();

    await updateTenantClientsInKV(env, tenantId);

    return Number(results[0].numUpdatedRows);
  }

  @Post("")
  @Security("oauth2managementApi", [""])
  @SuccessResponse(201, "Created")
  public async postConnections(
    @Request() request: RequestWithContext,
    @Path("tenantId") tenant_id: string,
    @Body()
    body: Omit<SqlConnection, "id" | "tenant_id" | "created_at" | "updated_at">,
  ): Promise<SqlConnection> {
    const { ctx } = request;
    const { env } = ctx;

    const db = getDb(env);
    const connection: SqlConnection = {
      ...body,
      tenant_id,
      id: nanoid(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    await db.insertInto("connections").values(connection).execute();

    await updateTenantClientsInKV(env, tenant_id);

    this.setStatus(201);
    return connection;
  }

  @Put("{id}")
  @Security("oauth2managementApi", [""])
  public async putConnection(
    @Request() request: RequestWithContext,
    @Path("tenantId") tenant_id: string,
    @Path("id") id: string,
    @Body()
    body: Omit<SqlConnection, "id" | "tenant_id" | "created_at" | "updated_at">,
  ): Promise<SqlConnection> {
    const { ctx } = request;
    const { env } = ctx;

    const db = getDb(env);

    const connection: SqlConnection = {
      ...body,
      tenant_id,
      id,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    try {
      await db
        .insertInto("connections")
        .values(connection)
        // .onConflict((oc) => oc.column("id").doUpdateSet(body))
        .execute();
    } catch (err: any) {
      if (!err.message.includes("AlreadyExists")) {
        throw err;
      }

      const { id, created_at, tenant_id, ...connectionUpdate } = connection;
      await db
        .updateTable("connections")
        .set(connectionUpdate)
        .where("id", "=", connection.id)
        .execute();
    }

    await updateTenantClientsInKV(env, tenant_id);

    this.setStatus(200);
    return connection;
  }
}
