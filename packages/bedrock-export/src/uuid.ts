// crypto.randomUUID exists in Node >= 19 and in browsers (secure contexts); not in ES lib typings.
const cryptoApi = (globalThis as unknown as { crypto: { randomUUID(): string } }).crypto;

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function uuidV4(): string {
  return cryptoApi.randomUUID();
}

export interface PackUuids {
  rpHeader: string;
  rpModule: string;
  bpHeader: string;
  bpModule: string;
}

/** Fresh, distinct UUIDs for one exported add-on (PLAN §3.2). */
export function freshPackUuids(): PackUuids {
  const ids = new Set<string>();
  while (ids.size < 4) ids.add(uuidV4());
  const [rpHeader, rpModule, bpHeader, bpModule] = [...ids] as [string, string, string, string];
  return { rpHeader, rpModule, bpHeader, bpModule };
}
