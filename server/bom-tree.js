export function buildBomTree(rows, rootProductId) {
  const roots = [];
  const stack = [];

  for (const row of rows) {
    const graphDepth = Number(row.depth);
    const positionDepth = Number.parseInt(String(row.level_code ?? ""), 10);
    const depth = String(row.parent_product_id) === String(rootProductId) && Number.isInteger(positionDepth) && positionDepth > 0
      ? positionDepth
      : graphDepth;
    if (!Number.isInteger(depth) || depth < 1) continue;

    const node = { ...row, depth, children: [] };
    stack.length = depth - 1;
    const parent = depth > 1 ? stack[depth - 2] : null;
    if (parent) parent.children.push(node);
    else roots.push(node);
    stack[depth - 1] = node;
  }

  return roots;
}
