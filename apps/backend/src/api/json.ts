/** JSON-safe copy: bigint becomes a decimal string (Express cannot serialize bigint). */
export function json<T>(v: T): unknown {
  return JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x)));
}
