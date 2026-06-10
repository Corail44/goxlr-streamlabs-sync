// Minimal RFC 6902 (JSON Patch) implementation - enough to mirror the
// GoXLR Utility daemon status object from its websocket patch stream.

function unescapeToken(t) {
  return t.replace(/~1/g, '/').replace(/~0/g, '~');
}

function parsePointer(p) {
  if (p === '') return [];
  if (!p.startsWith('/')) throw new Error(`Invalid JSON pointer: ${p}`);
  return p.slice(1).split('/').map(unescapeToken);
}

function getAt(doc, tokens) {
  let cur = doc;
  for (const t of tokens) {
    if (cur == null) return undefined;
    cur = Array.isArray(cur) ? cur[Number(t)] : cur[t];
  }
  return cur;
}

function clone(v) {
  return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
}

function applyOp(doc, op) {
  const tokens = parsePointer(op.path);

  switch (op.op) {
    case 'add':
    case 'replace': {
      if (tokens.length === 0) return clone(op.value);
      const parent = getAt(doc, tokens.slice(0, -1));
      const key = tokens[tokens.length - 1];
      if (parent == null) throw new Error(`Path not found: ${op.path}`);
      if (Array.isArray(parent)) {
        if (op.op === 'add') {
          if (key === '-') parent.push(clone(op.value));
          else parent.splice(Number(key), 0, clone(op.value));
        } else {
          parent[Number(key)] = clone(op.value);
        }
      } else {
        parent[key] = clone(op.value);
      }
      return doc;
    }
    case 'remove': {
      if (tokens.length === 0) return undefined;
      const parent = getAt(doc, tokens.slice(0, -1));
      const key = tokens[tokens.length - 1];
      if (parent == null) return doc;
      if (Array.isArray(parent)) parent.splice(Number(key), 1);
      else delete parent[key];
      return doc;
    }
    case 'move': {
      const v = clone(getAt(doc, parsePointer(op.from)));
      doc = applyOp(doc, { op: 'remove', path: op.from });
      return applyOp(doc, { op: 'add', path: op.path, value: v });
    }
    case 'copy': {
      const v = clone(getAt(doc, parsePointer(op.from)));
      return applyOp(doc, { op: 'add', path: op.path, value: v });
    }
    case 'test':
      return doc;
    default:
      throw new Error(`Unsupported patch op: ${op.op}`);
  }
}

export function applyPatch(doc, ops) {
  for (const op of ops) doc = applyOp(doc, op);
  return doc;
}
