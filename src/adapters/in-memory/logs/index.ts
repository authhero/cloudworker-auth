import { LogsDataAdapter } from "../../interfaces/Logs";
import { createLog } from "./create";
import { listLogs } from "./list";
import { LogMessage } from "../../../types";

export function createLogAdapter(): LogsDataAdapter {
  const users: LogMessage[] = [];

  return {
    create: createLog(users),
    list: listLogs(users),
  };
}
