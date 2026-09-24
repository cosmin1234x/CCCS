// A small in-memory stand-in for the parts of the Firestore Admin and Firebase
// Auth APIs that McAssist uses. It lets the real McAssist code paths run in
// unit tests (and local demos) without touching the live restaurant database.
// It mirrors Firestore's important behaviours: undefined values are rejected,
// merge writes deep-merge maps, FieldValue sentinels are applied on write and
// query results are copies.

export class MemoryTimestamp {
  constructor(ms) {
    this.ms = ms;
  }
  toMillis() {
    return this.ms;
  }
  toDate() {
    return new Date(this.ms);
  }
}

class Sentinel {
  constructor(op, value) {
    this.op = op;
    this.value = value;
  }
}

export function createMemoryFieldValue() {
  return {
    serverTimestamp: () => new Sentinel("serverTimestamp"),
    increment: (n) => new Sentinel("increment", n),
    arrayRemove: (...values) => new Sentinel("arrayRemove", values),
    arrayUnion: (...values) => new Sentinel("arrayUnion", values),
    delete: () => new Sentinel("delete"),
  };
}

const isPlain = (v) =>
  v !== null && typeof v === "object" && !Array.isArray(v) && !(v instanceof MemoryTimestamp) && !(v instanceof Sentinel);

function clone(value) {
  if (value instanceof MemoryTimestamp) return new MemoryTimestamp(value.ms);
  if (Array.isArray(value)) return value.map(clone);
  if (isPlain(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clone(v)]));
  return value;
}

function assertNoUndefined(value, path = "") {
  if (value === undefined)
    throw new Error("Cannot use \"undefined\" as a Firestore value" + (path ? " (found in field \"" + path + "\")" : "") + ".");
  if (Array.isArray(value)) value.forEach((v, i) => assertNoUndefined(v, path + "." + i));
  else if (isPlain(value)) for (const [k, v] of Object.entries(value)) assertNoUndefined(v, path ? path + "." + k : k);
}

function applyValue(current, incoming, now) {
  if (incoming instanceof Sentinel) {
    switch (incoming.op) {
      case "serverTimestamp":
        return new MemoryTimestamp(now());
      case "increment":
        return (Number(current) || 0) + Number(incoming.value);
      case "arrayRemove":
        return (Array.isArray(current) ? current : []).filter(
          (x) => !incoming.value.some((v) => JSON.stringify(v) === JSON.stringify(x)),
        );
      case "arrayUnion": {
        const base = Array.isArray(current) ? [...current] : [];
        for (const v of incoming.value) if (!base.some((x) => JSON.stringify(x) === JSON.stringify(v))) base.push(clone(v));
        return base;
      }
      case "delete":
        return Sentinel.DELETE;
      default:
        return undefined;
    }
  }
  if (isPlain(incoming)) {
    const base = isPlain(current) ? { ...current } : {};
    for (const [k, v] of Object.entries(incoming)) {
      const next = applyValue(base[k], v, now);
      if (next === Sentinel.DELETE) delete base[k];
      else base[k] = next;
    }
    return base;
  }
  return clone(incoming);
}
Sentinel.DELETE = Symbol("delete");

function writeFields(existing, data, merge, now) {
  const start = merge && existing ? clone(existing) : {};
  const out = start;
  for (const [k, v] of Object.entries(data)) {
    if (merge && isPlain(v)) {
      out[k] = applyValue(out[k], v, now);
    } else if (!merge && isPlain(v)) {
      out[k] = applyValue(undefined, v, now);
    } else {
      const next = applyValue(out[k], v, now);
      if (next === Sentinel.DELETE) delete out[k];
      else out[k] = next;
    }
  }
  return out;
}

function fieldValue(data, field) {
  return String(field)
    .split(".")
    .reduce((v, k) => (v == null ? undefined : v[k]), data);
}

function comparable(v) {
  if (v instanceof MemoryTimestamp) return v.ms;
  return v;
}

function matches(data, { field, op, value }) {
  const actual = comparable(fieldValue(data, field));
  const wanted = comparable(value);
  switch (op) {
    case "==":
      return actual === wanted;
    case "!=":
      return actual !== wanted && actual !== undefined;
    case "<":
      return actual !== undefined && actual < wanted;
    case "<=":
      return actual !== undefined && actual <= wanted;
    case ">":
      return actual !== undefined && actual > wanted;
    case ">=":
      return actual !== undefined && actual >= wanted;
    case "in":
      return Array.isArray(wanted) && wanted.includes(actual);
    case "array-contains":
      return Array.isArray(actual) && actual.includes(wanted);
    default:
      throw new Error("Unsupported operator " + op);
  }
}

let autoId = 0;
function newId() {
  autoId += 1;
  return "mem" + Date.now().toString(36) + autoId.toString(36) + Math.random().toString(36).slice(2, 8);
}

export function createMemoryFirestore(seed = {}, { now = () => Date.now() } = {}) {
  const docs = new Map();
  const log = [];
  const db = {};

  class DocSnapshot {
    constructor(ref, data) {
      this.ref = ref;
      this.id = ref.id;
      this.exists = data !== undefined;
      this._data = data;
    }
    data() {
      return this._data === undefined ? undefined : clone(this._data);
    }
    get(field) {
      return this._data === undefined ? undefined : clone(fieldValue(this._data, field));
    }
  }

  class DocumentReference {
    constructor(path) {
      this.path = path;
      this.id = path.split("/").pop();
    }
    get parent() {
      return new CollectionReference(this.path.split("/").slice(0, -1).join("/"));
    }
    collection(name) {
      return new CollectionReference(this.path + "/" + name);
    }
    async get() {
      return new DocSnapshot(this, docs.get(this.path));
    }
    async set(data, options = {}) {
      applyWrite({ type: "set", ref: this, data, options });
      return { writeTime: new MemoryTimestamp(now()) };
    }
    async update(data) {
      applyWrite({ type: "update", ref: this, data });
      return { writeTime: new MemoryTimestamp(now()) };
    }
    async create(data) {
      if (docs.has(this.path)) throw Object.assign(new Error("Document already exists: " + this.path), { code: 6 });
      applyWrite({ type: "set", ref: this, data, options: {} });
    }
    async delete() {
      applyWrite({ type: "delete", ref: this });
    }
  }

  class Query {
    constructor(path, filters = [], order = [], max = null) {
      this.path = path;
      this.filters = filters;
      this.order = order;
      this.max = max;
    }
    where(field, op, value) {
      if (value === undefined) throw new Error("Cannot use undefined in a where() filter.");
      return new Query(this.path, [...this.filters, { field, op, value }], this.order, this.max);
    }
    orderBy(field, direction = "asc") {
      return new Query(this.path, this.filters, [...this.order, { field, direction }], this.max);
    }
    limit(n) {
      return new Query(this.path, this.filters, this.order, n);
    }
    async get() {
      const depth = this.path.split("/").length + 1;
      let rows = [...docs.entries()]
        .filter(([p]) => p.startsWith(this.path + "/") && p.split("/").length === depth)
        .map(([p, data]) => ({ ref: new DocumentReference(p), data }))
        .filter(({ data }) => this.filters.every((f) => matches(data, f)));
      for (const { field, direction } of [...this.order].reverse()) {
        rows = rows
          .filter(({ data }) => fieldValue(data, field) !== undefined)
          .sort((a, b) => {
            const x = comparable(fieldValue(a.data, field));
            const y = comparable(fieldValue(b.data, field));
            const c = x < y ? -1 : x > y ? 1 : 0;
            return direction === "desc" ? -c : c;
          });
      }
      if (this.max != null) rows = rows.slice(0, this.max);
      const snaps = rows.map(({ ref, data }) => new DocSnapshot(ref, data));
      return {
        docs: snaps,
        size: snaps.length,
        empty: snaps.length === 0,
        forEach: (fn) => snaps.forEach(fn),
      };
    }
  }

  class CollectionReference extends Query {
    constructor(path) {
      super(path);
      this.id = path.split("/").pop();
    }
    doc(id) {
      return new DocumentReference(this.path + "/" + (id || newId()));
    }
    async add(data) {
      const ref = this.doc();
      await ref.set(data);
      return ref;
    }
  }

  function applyWrite(op) {
    const path = op.ref.path;
    if (db.failWrites && db.failWrites(op)) throw Object.assign(new Error("Simulated write failure"), { code: 14 });
    if (op.type === "delete") {
      docs.delete(path);
      log.push({ type: "delete", path });
      return;
    }
    assertNoUndefined(op.data);
    const existing = docs.get(path);
    if (op.type === "update" && !existing)
      throw Object.assign(new Error("No document to update: " + path), { code: 5 });
    const merge = op.type === "update" || Boolean(op.options?.merge);
    docs.set(path, writeFields(existing, op.data, merge, now));
    log.push({ type: op.type, path, data: clone(docs.get(path)) });
  }

  db.collection = (path) => new CollectionReference(path);
  db.doc = (path) => new DocumentReference(path);
  db.batch = () => {
    const ops = [];
    return {
      set(ref, data, options) {
        ops.push({ type: "set", ref, data, options });
        return this;
      },
      update(ref, data) {
        ops.push({ type: "update", ref, data });
        return this;
      },
      delete(ref) {
        ops.push({ type: "delete", ref });
        return this;
      },
      async commit() {
        for (const op of ops) assertNoUndefined(op.data ?? null);
        for (const op of ops) applyWrite(op);
      },
    };
  };
  db.runTransaction = async (fn) => {
    const ops = [];
    const tx = {
      get: (ref) => (typeof ref.get === "function" ? ref.get() : Promise.reject(new Error("Unsupported"))),
      set(ref, data, options) {
        ops.push({ type: "set", ref, data, options });
        return tx;
      },
      update(ref, data) {
        ops.push({ type: "update", ref, data });
        return tx;
      },
      delete(ref) {
        ops.push({ type: "delete", ref });
        return tx;
      },
    };
    const result = await fn(tx);
    for (const op of ops) applyWrite(op);
    return result;
  };

  // Test helpers.
  db.read = (path) => (docs.has(path) ? clone(docs.get(path)) : undefined);
  db.list = (collectionPath) => {
    const depth = collectionPath.split("/").length + 1;
    return [...docs.entries()]
      .filter(([p]) => p.startsWith(collectionPath + "/") && p.split("/").length === depth)
      .map(([p, data]) => ({ id: p.split("/").pop(), ...clone(data) }));
  };
  db.put = (path, data) => {
    assertNoUndefined(data);
    docs.set(path, clone(data));
  };
  db.writes = log;
  db.failWrites = null;

  for (const [path, data] of Object.entries(seed)) db.put(path, data);
  return db;
}

export function createMemoryAuth(users = [], { linkBase = "https://mc-training-portal.firebaseapp.com/__/auth/action" } = {}) {
  const byUid = new Map();
  const notFound = () => Object.assign(new Error("There is no user record corresponding to the provided identifier."), { code: "auth/user-not-found" });
  for (const u of users) byUid.set(u.uid, { disabled: false, ...u });
  let counter = 0;
  const auth = {
    users: byUid,
    revoked: new Set(),
    async createUser(props = {}) {
      const email = String(props.email || "").toLowerCase();
      if (email && [...byUid.values()].some((u) => String(u.email || "").toLowerCase() === email))
        throw Object.assign(new Error("The email address is already in use by another account."), { code: "auth/email-already-exists" });
      counter += 1;
      const uid = props.uid || "auth" + counter + Math.random().toString(36).slice(2, 10);
      const record = { uid, email, displayName: props.displayName || "", disabled: Boolean(props.disabled) };
      byUid.set(uid, record);
      return { ...record };
    },
    async getUser(uid) {
      const u = byUid.get(uid);
      if (!u) throw notFound();
      return { ...u };
    },
    async getUserByEmail(email) {
      const u = [...byUid.values()].find((x) => String(x.email || "").toLowerCase() === String(email || "").toLowerCase());
      if (!u) throw notFound();
      return { ...u };
    },
    async updateUser(uid, props) {
      const u = byUid.get(uid);
      if (!u) throw notFound();
      Object.assign(u, props);
      return { ...u };
    },
    async deleteUser(uid) {
      if (!byUid.has(uid)) throw notFound();
      byUid.delete(uid);
    },
    async revokeRefreshTokens(uid) {
      if (!byUid.has(uid)) throw notFound();
      auth.revoked.add(uid);
    },
    async generatePasswordResetLink(email) {
      await auth.getUserByEmail(email);
      return linkBase + "?mode=resetPassword&oobCode=test-" + encodeURIComponent(email);
    },
  };
  return auth;
}
