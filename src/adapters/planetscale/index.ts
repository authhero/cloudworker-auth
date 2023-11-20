import { createUsersAdapter } from "./users";
import { createMembersAdapter } from "./members";
import { createTenantsAdapter } from "./tenants";
import { createLogsAdapter } from "./logs";
import { Env } from "../../types";
import { createSessionsAdapter } from "./sessions";
import { createTicketsAdapter } from "./tickets";
import { createOTPAdapter } from "./otps";
import { createPasswordAdapter } from "./passwords";
import { createCodesAdapter } from "./codes";
import { createUniversalLoginSessionAdapter } from "./universalLoginSessions";

export default function createAdapters(env: Env) {
  return {
    members: createMembersAdapter(env),
    users: createUsersAdapter(env),
    sessions: createSessionsAdapter(env),
    tenants: createTenantsAdapter(env),
    tickets: createTicketsAdapter(env),
    universalLoginSessions: createUniversalLoginSessionAdapter(env),
    OTP: createOTPAdapter(env),
    logs: createLogsAdapter(env),
    passwords: createPasswordAdapter(env),
    codes: createCodesAdapter(env),
  };
}
