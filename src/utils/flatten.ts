export function flattenObject(obj: any, prefix = "", res: any = {}) {
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const newKey = prefix ? `${prefix}_${key}` : key;
      if (
        typeof obj[key] === "object" &&
        obj[key] !== null &&
        !Array.isArray(obj[key])
      ) {
        flattenObject(obj[key], newKey, res);
      } else {
        res[newKey] = obj[key];
      }
    }
  }
  return res;
}

export function unflattenObject(
  flatObj: { [key: string]: any },
  prefixes: string[],
): { [key: string]: any } {
  const result: { [key: string]: any } = {};

  for (const [key, value] of Object.entries(flatObj)) {
    const matchingPrefix = prefixes.find((prefix) =>
      key.startsWith(`${prefix}_`),
    );

    if (!matchingPrefix) {
      result[key] = value;
    } else {
      const newKey = key.slice(matchingPrefix.length + 1);
      result[matchingPrefix] = {
        ...result[matchingPrefix],
        [newKey]: value,
      };
    }
  }

  return result;
}
