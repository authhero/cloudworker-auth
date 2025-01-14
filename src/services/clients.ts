import { Env } from "../types";
import { getDefaultSettings } from "../models/DefaultSettings";
import { HTTPException } from "hono/http-exception";
import { Client, connectionSchema } from "authhero";
import { flattenObject, unflattenObject } from "../utils/flatten";

export async function getClient(env: Env, clientId: string): Promise<Client> {
  const client = await env.data.clients.get(clientId);
  if (!client) {
    throw new HTTPException(403, { message: "Client not found" });
  }

  const envDefaultSettings = await getDefaultSettings(env);

  const connections = client.connections
    .map((connection) => {
      const envDefaultConnection =
        envDefaultSettings?.connections?.find(
          (c) => c.name === connection.name,
        ) || {};

      const mergedConnection = connectionSchema.parse(
        unflattenObject(
          {
            ...flattenObject(envDefaultConnection),
            ...flattenObject(connection),
          },
          ["options"],
        ),
      );

      return mergedConnection;
    })
    .filter((c) => c);

  return {
    ...client,
    web_origins: [
      ...(envDefaultSettings.web_origins || []),
      ...(client.web_origins || []),
      `${env.ISSUER}u/login`,
    ],
    allowed_logout_urls: [
      ...(envDefaultSettings.allowed_logout_urls || []),
      ...(client.allowed_logout_urls || []),
      env.ISSUER,
    ],
    callbacks: [
      ...(envDefaultSettings.callbacks || []),
      ...(client.callbacks || []),
      `${env.ISSUER}u/info`,
    ],
    connections,
    domains: [...client.domains, ...(envDefaultSettings.domains || [])],
    tenant: {
      ...envDefaultSettings.tenant,
      ...client.tenant,
    },
  };
}
