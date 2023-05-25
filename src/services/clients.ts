import { Env } from "../types/Env";
import { Client } from "../types/Client";

export async function getClient(env: Env, clientId: string): Promise<Client> {
  const client = await env.CLIENTS.get<string>(clientId);

  if (!client) {
    throw new Error("Client not found");
  }
  return JSON.parse(client);
}