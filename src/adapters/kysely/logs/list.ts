import { Database, LogsResponse, SqlLog } from "../../../types";
import { Kysely } from "kysely";
import { ListParams } from "../../interfaces/ListParams";
import getCountAsInt from "../../../utils/getCountAsInt";
import { luceneFilter } from "../helpers/filter";
import { getLogResponseBase } from "../../../utils/logs";

function mapLog(log: SqlLog): LogsResponse {
  const { id } = log;

  const logResponseBaseBase = getLogResponseBase(log);

  return {
    ...logResponseBaseBase,
    log_id: id,
    _id: id,
  };
}

export function listLogs(db: Kysely<Database>) {
  return async (tenantId: string, params: ListParams) => {
    let query = db.selectFrom("logs").where("logs.tenant_id", "=", tenantId);

    if (params.q) {
      query = luceneFilter(db, query, params.q, ["user_id"]);
    }

    // TEMP FIX - hardcoded date desc for now
    query = query.orderBy("date", "desc");

    // TODO - sorting not implemented anywhere yet
    // if (params.sort && params.sort.sort_by) {
    //   const { ref } = db.dynamic;
    //   query = query.orderBy(ref(params.sort.sort_by), params.sort.sort_order);
    // }

    const filteredQuery = query
      .offset(params.page * params.per_page)
      .limit(params.per_page);

    const logs = await filteredQuery.selectAll().execute();

    const [{ count }] = await query
      .select((eb) => eb.fn.countAll().as("count"))
      .execute();

    const countInt = getCountAsInt(count);

    return {
      logs: logs.map(mapLog),
      start: (params.page - 1) * params.per_page,
      limit: params.per_page,
      length: countInt,
    };
  };
}
