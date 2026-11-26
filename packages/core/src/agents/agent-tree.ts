type TreeAgent = { id: string; parentAgentId?: string; busy?: boolean }

type NodeData<A> = {
  agent: A
  depth: number
  descendantCount: number
  busyDescendantCount: number
  rootReason?: "orphan" | "cycle"
}

type MutableNode<A> = NodeData<A> & { children: MutableNode<A>[] }

export type AgentTreeNode<A> = Readonly<NodeData<A>> & {
  readonly children: readonly AgentTreeNode<A>[]
}

export type AgentTree<A> = {
  readonly roots: readonly AgentTreeNode<A>[]
  readonly byId: ReadonlyMap<string, AgentTreeNode<A>>
  readonly preOrder: readonly AgentTreeNode<A>[]
  parentOf(id: string): A | undefined
  pathTo(id: string): A[]
}

type Entry<A> = {
  node: MutableNode<A>
  order: number
  parent?: Entry<A>
  visitedFrom?: number
}

function normalizeParents<A extends TreeAgent>(entries: ReadonlyMap<string, Entry<A>>): void {
  for (const entry of entries.values()) {
    const parentId = entry.node.agent.parentAgentId
    if (parentId === undefined) continue

    entry.parent = entries.get(parentId)
    if (!entry.parent) entry.node.rootReason = "orphan"
  }

  for (const start of entries.values()) {
    let entry: Entry<A> | undefined = start
    while (entry && entry.visitedFrom === undefined) {
      entry.visitedFrom = start.order
      entry = entry.parent
    }
    if (entry?.visitedFrom !== start.order) continue

    // Reaching this walk's marker identifies a cycle. Only its members can become the root.
    let root = entry
    for (let member = entry.parent; member && member !== entry; member = member.parent) {
      if (member.order < root.order) root = member
    }
    root.parent = undefined
    root.node.rootReason = "cycle"
  }
}

/** Builds an ordered forest from a snapshot in linear time and space. */
export function buildAgentTree<A extends TreeAgent>(agents: readonly A[]): AgentTree<A> {
  const entries = new Map<string, Entry<A>>()
  for (const agent of agents) {
    if (entries.has(agent.id)) continue

    entries.set(agent.id, {
      order: entries.size,
      node: { agent, depth: 0, descendantCount: 0, busyDescendantCount: 0, children: [] },
    })
  }
  normalizeParents(entries)

  const roots: MutableNode<A>[] = []
  const byId = new Map<string, AgentTreeNode<A>>()
  for (const [id, { node, parent }] of entries) {
    byId.set(id, node)
    if (parent) parent.node.children.push(node)
    else roots.push(node)
  }

  const preOrder: MutableNode<A>[] = []
  const stack = roots.slice().reverse()
  for (let node = stack.pop(); node; node = stack.pop()) {
    preOrder.push(node)
    for (let index = node.children.length - 1; index >= 0; index--) {
      const child = node.children[index]
      if (!child) continue

      child.depth = node.depth + 1
      stack.push(child)
    }
  }

  // Reverse pre-order visits all descendants before their parents, so each edge is counted once.
  for (let index = preOrder.length - 1; index >= 0; index--) {
    const node = preOrder[index]
    if (!node) continue

    const parent = entries.get(node.agent.id)?.parent?.node
    if (!parent) continue

    parent.descendantCount += node.descendantCount + 1
    parent.busyDescendantCount += node.busyDescendantCount + (node.agent.busy === true ? 1 : 0)
  }

  return {
    roots,
    byId,
    preOrder,
    parentOf: (id) => entries.get(id)?.parent?.node.agent,
    pathTo(id) {
      const path: A[] = []
      for (let entry = entries.get(id); entry; entry = entry.parent) {
        path.push(entry.node.agent)
      }
      return path.reverse()
    },
  }
}

/** Returns descendants with children before parents, preserving sibling order and omitting id. */
export function descendantsPostOrder<A>(tree: AgentTree<A>, id: string): A[] {
  const descendants: A[] = []
  const stack = tree.byId.get(id)?.children.slice() ?? []

  // Walk parents first and siblings right to left, then reverse both orders together.
  for (let node = stack.pop(); node; node = stack.pop()) {
    descendants.push(node.agent)
    for (const child of node.children) stack.push(child)
  }
  return descendants.reverse()
}
