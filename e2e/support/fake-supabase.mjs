/**
 * TEST ONLY. A tiny stand-in for the Supabase HTTP API, backed by a real local
 * Postgres database that has the app's migrations applied (with the shim in
 * supabase/tests/_shim). It lets end-to-end tests run the real app, the real
 * database functions, and the real row-level security without the Supabase
 * Docker stack.
 *
 * It implements only what the app's read paths and RPC calls use:
 *   GET  /auth/v1/user                 (trusts the JWT's sub claim, no signature check)
 *   GET  /rest/v1/<table>?select=...   (columns, one-level-or-deeper embeds, eq/neq/is/in/lt/lte/gt/gte, order, limit, offset)
 *   POST /rest/v1/rpc/<function>       (named arguments)
 * Each query runs as the `authenticated` (or `anon`) role with the JWT claims
 * set, exactly as PostgREST does. Never point a real app at this.
 */
import http from "node:http";
import pg from "pg";

const PORT = Number(process.env.FAKE_SUPABASE_PORT ?? 54399);

// Match PostgREST's JSON: dates as "YYYY-MM-DD", timestamps as ISO 8601 with
// an offset, and bigint counts as numbers.
const isoTs = (v) => v.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00");
pg.types.setTypeParser(1082, (v) => v); // date
pg.types.setTypeParser(1114, (v) => v.replace(" ", "T")); // timestamp
pg.types.setTypeParser(1184, isoTs); // timestamptz
pg.types.setTypeParser(20, (v) => Number(v)); // bigint
const pool = new pg.Pool({ database: process.env.E2E_DB_NAME ?? "crit_race_series_e2e", options: "-c timezone=UTC" });
// The test setup drops and recreates the database, which ends idle
// connections. The pool reconnects on the next query.
pool.on("error", (err) => console.warn("fake-supabase: idle connection closed:", err.message));

const fkCache = new Map();
async function foreignKeys(client) {
  if (fkCache.size) return fkCache;
  const { rows } = await client.query(`
    select c.conname, src.relname as src, tgt.relname as tgt,
      (select attname from pg_attribute where attrelid = c.conrelid and attnum = c.conkey[1]) as src_col,
      (select attname from pg_attribute where attrelid = c.confrelid and attnum = c.confkey[1]) as tgt_col
    from pg_constraint c
    join pg_class src on src.oid = c.conrelid
    join pg_class tgt on tgt.oid = c.confrelid
    join pg_namespace n on n.oid = src.relnamespace
    where c.contype = 'f' and n.nspname = 'public'`);
  for (const r of rows) fkCache.set(r.conname, r);
  return fkCache;
}

const ident = (s) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new Error(`bad identifier ${s}`);
  return `"${s}"`;
};

// Splits "a, b, c(d, e(f)), g" at top-level commas.
function splitTop(s) {
  const out = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

let aliasN = 0;
async function selectList(client, table, alias, select) {
  const fks = await foreignKeys(client);
  const parts = [];
  for (const item of splitTop(select)) {
    const m = /^(?:([a-z_]+):)?([a-z_]+)(?:!([a-z_]+))?(?:!inner)?\((.*)\)$/s.exec(item);
    if (!m) {
      if (item === "*") parts.push(`${alias}.*`);
      else parts.push(`${alias}.${ident(item)}`);
      continue;
    }
    const [, label, target, hint, inner] = m;
    const sub = `t${++aliasN}`;
    const candidates = [...fks.values()].filter((f) =>
      hint ? f.conname === hint : (f.src === table && f.tgt === target) || (f.src === target && f.tgt === table),
    );
    const fk = candidates[0];
    if (!fk) throw new Error(`no relationship ${table} -> ${target}`);
    const cols = await selectList(client, target, sub, inner);
    const named = cols.filter((c) => c.name !== "*");
    const pairs = `jsonb_build_object(${named.map((c) => `'${c.name}', ${c.expr}`).join(", ")})`;
    // "table(*)" embeds every column, as PostgREST does.
    const obj = cols.some((c) => c.name === "*") ? (named.length ? `(to_jsonb(${sub}) || ${pairs})` : `to_jsonb(${sub})`) : pairs;
    let expr;
    if (fk.src === table) {
      // Many-to-one: an object (or null).
      expr = `(select ${obj} from public.${ident(target)} ${sub} where ${sub}.${ident(fk.tgt_col)} = ${alias}.${ident(fk.src_col)})`;
    } else {
      // One-to-many: an array.
      expr = `coalesce((select json_agg(${obj}) from public.${ident(target)} ${sub} where ${sub}.${ident(fk.src_col)} = ${alias}.${ident(fk.tgt_col)}), '[]'::json)`;
    }
    parts.push({ name: label ?? target, expr });
  }
  return parts.map((p) => (typeof p === "string" ? { name: p.split(".")[1]?.replaceAll('"', "") ?? "*", expr: p } : p));
}

function filterSql(alias, key, raw, params) {
  const col = `${alias}.${ident(key)}`;
  const neg = raw.startsWith("not.");
  const v = neg ? raw.slice(4) : raw;
  const dot = v.indexOf(".");
  const op = v.slice(0, dot);
  const val = v.slice(dot + 1);
  let sql;
  const p = (x) => {
    params.push(x);
    return `$${params.length}`;
  };
  switch (op) {
    case "eq": sql = `${col}::text = ${p(val)}`; break;
    case "neq": sql = `${col}::text <> ${p(val)}`; break;
    case "lt": sql = `${col} < ${p(val)}`; break;
    case "lte": sql = `${col} <= ${p(val)}`; break;
    case "gt": sql = `${col} > ${p(val)}`; break;
    case "gte": sql = `${col} >= ${p(val)}`; break;
    case "is": sql = `${col} is ${val === "null" ? "null" : val === "true" ? "true" : "false"}`; break;
    case "in": sql = `${col}::text = any(${p(val.replace(/^\(|\)$/g, "").split(",").map((s) => s.replace(/^"|"$/g, "")))}::text[])`; break;
    default: throw new Error(`unsupported filter ${op}`);
  }
  return neg ? `not (${sql})` : sql;
}

async function asRole(claims, fn) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    await client.query(`set local role ${claims.role === "authenticated" ? "authenticated" : "anon"}`);
    const out = await fn(client);
    await client.query("commit");
    return out;
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

function decodeJwt(header) {
  const token = (header ?? "").replace(/^Bearer\s+/i, "");
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(body === undefined ? "" : JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const claims = decodeJwt(req.headers.authorization);
  const auth = claims?.sub ? { sub: claims.sub, role: "authenticated", email: claims.email } : { role: "anon" };
  const wantsObject = (req.headers.accept ?? "").includes("vnd.pgrst.object");
  try {
    // Stand-in for Open-Meteo's /v1/forecast (same response shape, made-up
    // values), so tests can exercise the weather panel without the network.
    if (url.pathname === "/v1/forecast") {
      const date = url.searchParams.get("start_date") ?? "2027-05-12";
      const time = Array.from({ length: 24 }, (_, h) => `${date}T${String(h).padStart(2, "0")}:00`);
      return send(res, 200, {
        latitude: Number(url.searchParams.get("latitude")),
        longitude: Number(url.searchParams.get("longitude")),
        timezone: url.searchParams.get("timezone"),
        hourly: {
          time,
          temperature_2m: time.map((_, h) => 60 + h / 2),
          apparent_temperature: time.map((_, h) => 59 + h / 2),
          precipitation_probability: time.map(() => 20),
          wind_speed_10m: time.map(() => 9),
          wind_gusts_10m: time.map(() => 17),
          wind_direction_10m: time.map(() => 315),
        },
        daily: { time: [date], sunrise: [`${date}T06:24`], sunset: [`${date}T20:31`] },
      });
    }

    if (url.pathname === "/auth/v1/user") {
      if (!claims?.sub) return send(res, 401, { message: "no session" });
      return send(res, 200, {
        id: claims.sub, aud: "authenticated", role: "authenticated", email: claims.email,
        app_metadata: {}, user_metadata: {}, created_at: new Date(0).toISOString(),
      });
    }

    const rpc = /^\/rest\/v1\/rpc\/([a-z_]+)$/.exec(url.pathname);
    if (rpc && req.method === "POST") {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const args = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
      const rows = await asRole(auth, async (client) => {
        const meta = await client.query(
          "select proretset, (select typtype from pg_type where oid = prorettype) as typtype from pg_proc where proname = $1 and pronamespace = 'public'::regnamespace",
          [rpc[1]],
        );
        const params = [];
        const named = Object.entries(args).map(([k, v]) => {
          params.push(v !== null && typeof v === "object" && !Array.isArray(v) ? JSON.stringify(v) : v);
          return `${ident(k)} => $${params.length}`;
        });
        const r = await client.query(`select * from public.${ident(rpc[1])}(${named.join(", ")})`, params);
        return { rows: r.rows, setof: meta.rows[0]?.proretset || meta.rows[0]?.typtype === "c" };
      });
      if (!rows.setof) return send(res, 200, rows.rows[0] ? Object.values(rows.rows[0])[0] : null);
      if (wantsObject) return rows.rows.length === 1 ? send(res, 200, rows.rows[0]) : send(res, 406, { message: "not one row" });
      return send(res, 200, rows.rows);
    }

    const table = /^\/rest\/v1\/([a-z_]+)$/.exec(url.pathname);
    if (table && req.method === "GET") {
      const rows = await asRole(auth, async (client) => {
        const alias = "t0";
        const cols = await selectList(client, table[1], alias, url.searchParams.get("select") ?? "*");
        const params = [];
        const where = [];
        let order = "";
        let limit = "";
        let offset = "";
        for (const [k, v] of url.searchParams) {
          if (k === "select") continue;
          if (k === "order") {
            order = ` order by ${v.split(",").map((o) => { const [c, dir] = o.split("."); return `${alias}.${ident(c)} ${dir === "desc" ? "desc" : "asc"}`; }).join(", ")}`;
          } else if (k === "limit") limit = ` limit ${Number(v)}`;
          else if (k === "offset") offset = ` offset ${Number(v)}`;
          else where.push(filterSql(alias, k, v, params));
        }
        const selectSql = cols.map((c) => (c.name === "*" ? c.expr : `${c.expr} as "${c.name}"`)).join(", ");
        const sql = `select ${selectSql} from public.${ident(table[1])} ${alias}${where.length ? ` where ${where.join(" and ")}` : ""}${order}${limit}${offset}`;
        return (await client.query(sql, params)).rows;
      });
      if (wantsObject) {
        if (rows.length === 1) return send(res, 200, rows[0]);
        return send(res, 406, { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" });
      }
      return send(res, 200, rows);
    }

    return send(res, 501, { message: `fake-supabase: ${req.method} ${url.pathname} not implemented` });
  } catch (e) {
    // PostgREST returns the Postgres error message, which the app maps to text.
    return send(res, 400, { message: e.message, code: e.code ?? "XX000" });
  }
});

server.listen(PORT, "127.0.0.1", () => console.log(`fake-supabase listening on ${PORT}`));
