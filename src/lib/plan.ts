import type { NodeStatus } from "./types";

export interface PlanNodeInput {
  key: string;
  title: string;
  summary?: string;
  deps?: string[];
  known?: boolean;
}

/** Returns a list of problems; empty means the plan is a valid DAG. */
export function validatePlan(nodes: PlanNodeInput[]): string[] {
  const errors: string[] = [];
  if (nodes.length < 2) errors.push("В плане должно быть минимум 2 узла.");
  if (nodes.length > 40) errors.push("В плане не больше 40 узлов.");
  const keys = new Set<string>();
  for (const n of nodes) {
    if (!/^[a-z0-9][a-z0-9_-]{0,47}$/.test(n.key)) {
      errors.push(`Некорректный key "${n.key}": латиница в нижнем регистре, цифры, "-" и "_", до 48 символов.`);
    }
    if (keys.has(n.key)) errors.push(`Повторяющийся key "${n.key}".`);
    keys.add(n.key);
  }
  for (const n of nodes) {
    for (const d of n.deps ?? []) {
      if (d === n.key) errors.push(`Узел "${n.key}" зависит сам от себя.`);
      else if (!keys.has(d)) errors.push(`Узел "${n.key}" ссылается на несуществующий "${d}".`);
    }
  }
  if (errors.length) return errors;
  if (topoOrder(nodes) === null) errors.push("В зависимостях есть цикл.");
  return errors;
}

/** Topological order of keys, or null if there is a cycle. Stable w.r.t. input order. */
export function topoOrder(nodes: { key: string; deps?: string[] }[]): string[] | null {
  const deps = new Map(nodes.map((n) => [n.key, new Set(n.deps ?? [])]));
  const done = new Set<string>();
  const out: string[] = [];
  while (out.length < nodes.length) {
    const next = nodes.find((n) => !done.has(n.key) && [...deps.get(n.key)!].every((d) => done.has(d)));
    if (!next) return null;
    done.add(next.key);
    out.push(next.key);
  }
  return out;
}

/** A node is available when every prerequisite is mastered. */
export function isAvailable(
  node: { deps: string[] },
  statusByKey: Map<string, NodeStatus> | Record<string, NodeStatus>,
): boolean {
  const get = (k: string) => (statusByKey instanceof Map ? statusByKey.get(k) : statusByKey[k]);
  return node.deps.every((d) => get(d) === "mastered");
}
