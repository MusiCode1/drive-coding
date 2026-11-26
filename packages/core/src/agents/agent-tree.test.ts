import { describe, expect, it } from "vitest"
import { buildAgentTree, descendantsPostOrder } from "./agent-tree.js"

function chain(length: number) {
  return Array.from({ length }, (_, index) => ({
    id: String(index),
    parentAgentId: index === 0 ? undefined : String(index - 1),
    busy: index % 2 === 0,
  }))
}

describe("buildAgentTree", () => {
  it("keeps all five levels and exposes the same tree through each lookup", () => {
    const input = chain(5)
    const tree = buildAgentTree(input)

    expect(tree.roots).toEqual([tree.byId.get("0")])
    expect(tree.preOrder.map((node) => node.agent)).toEqual(input)
    expect(tree.preOrder.map((node) => node.depth)).toEqual([0, 1, 2, 3, 4])
    expect(tree.preOrder.map((node) => node.descendantCount)).toEqual([4, 3, 2, 1, 0])
    expect(tree.preOrder.map((node) => node.busyDescendantCount)).toEqual([2, 2, 1, 1, 0])
    expect(tree.byId.get("0")?.children[0]).toBe(tree.byId.get("1"))
    expect(tree.parentOf("4")).toBe(input[3])
    expect(tree.pathTo("4")).toEqual(input)
    expect(tree.pathTo("0")).toEqual([input[0]])
    expect(tree.parentOf("0")).toBeUndefined()
    expect(tree.byId.get("unknown")).toBeUndefined()
    expect(tree.parentOf("unknown")).toBeUndefined()
    expect(tree.pathTo("unknown")).toEqual([])
    expect(descendantsPostOrder(tree, "4")).toEqual([])
    expect(descendantsPostOrder(tree, "unknown")).toEqual([])
  })

  it("keeps roots and siblings in input order and completes each branch before the next", () => {
    const tree = buildAgentTree([
      { id: "left", parentAgentId: "root" },
      { id: "other-root" },
      { id: "right-leaf", parentAgentId: "right", busy: true },
      { id: "root", busy: true },
      { id: "right", parentAgentId: "root", busy: false },
      { id: "left-leaf", parentAgentId: "left" },
    ])

    expect(tree.roots.map((node) => node.agent.id)).toEqual(["other-root", "root"])
    expect(tree.byId.get("root")?.children.map((node) => node.agent.id)).toEqual(["left", "right"])
    expect(tree.preOrder.map((node) => node.agent.id)).toEqual([
      "other-root",
      "root",
      "left",
      "left-leaf",
      "right",
      "right-leaf",
    ])
    expect(tree.byId.get("root")).toMatchObject({ descendantCount: 4, busyDescendantCount: 1 })
    expect(descendantsPostOrder(tree, "root").map((agent) => agent.id)).toEqual([
      "left-leaf",
      "left",
      "right-leaf",
      "right",
    ])
  })

  it("promotes only the orphan and preserves its child and grandchild", () => {
    const tree = buildAgentTree([
      { id: "grandchild", parentAgentId: "child", busy: true },
      { id: "orphan", parentAgentId: "missing" },
      { id: "child", parentAgentId: "orphan" },
    ])

    expect(tree.roots).toEqual([tree.byId.get("orphan")])
    expect(tree.byId.get("orphan")).toMatchObject({
      depth: 0,
      rootReason: "orphan",
      descendantCount: 2,
      busyDescendantCount: 1,
    })
    expect(tree.byId.get("child")?.rootReason).toBeUndefined()
    expect(tree.parentOf("orphan")).toBeUndefined()
    expect(tree.pathTo("grandchild").map((agent) => agent.id)).toEqual([
      "orphan",
      "child",
      "grandchild",
    ])
    expect(descendantsPostOrder(tree, "orphan").map((agent) => agent.id)).toEqual([
      "grandchild",
      "child",
    ])
  })

  it("cuts a self-loop and keeps the branch below it", () => {
    const tree = buildAgentTree([
      { id: "child", parentAgentId: "self" },
      { id: "self", parentAgentId: "self", busy: true },
    ])

    expect(tree.roots.map((node) => node.agent.id)).toEqual(["self"])
    expect(tree.byId.get("self")).toMatchObject({
      rootReason: "cycle",
      descendantCount: 1,
      busyDescendantCount: 0,
    })
    expect(tree.parentOf("self")).toBeUndefined()
    expect(descendantsPostOrder(tree, "self").map((agent) => agent.id)).toEqual(["child"])
  })

  it("cuts the first actual cycle member even when an incoming branch appears earlier", () => {
    const tree = buildAgentTree([
      { id: "branch", parentAgentId: "B", busy: true },
      { id: "A", parentAgentId: "B" },
      { id: "B", parentAgentId: "A", busy: true },
    ])

    expect(tree.roots.map((node) => node.agent.id)).toEqual(["A"])
    expect(tree.byId.get("A")).toMatchObject({
      rootReason: "cycle",
      descendantCount: 2,
      busyDescendantCount: 2,
    })
    expect(tree.parentOf("A")).toBeUndefined()
    expect(tree.pathTo("branch").map((agent) => agent.id)).toEqual(["A", "B", "branch"])
    expect(descendantsPostOrder(tree, "A").map((agent) => agent.id)).toEqual(["branch", "B"])
    expect(descendantsPostOrder(tree, "B").map((agent) => agent.id)).toEqual(["branch"])
  })

  it("cuts one edge in a three-node cycle using input order", () => {
    const tree = buildAgentTree([
      { id: "branch", parentAgentId: "A" },
      { id: "C", parentAgentId: "A" },
      { id: "B", parentAgentId: "C" },
      { id: "A", parentAgentId: "B" },
    ])

    expect(tree.roots.map((node) => node.agent.id)).toEqual(["C"])
    expect(tree.byId.get("C")?.rootReason).toBe("cycle")
    expect(tree.byId.get("A")?.rootReason).toBeUndefined()
    expect(tree.byId.get("B")?.rootReason).toBeUndefined()
    expect(tree.preOrder.map((node) => node.agent.id)).toEqual(["C", "B", "A", "branch"])
    expect(tree.pathTo("A").map((agent) => agent.id)).toEqual(["C", "B", "A"])
    expect(descendantsPostOrder(tree, "C").map((agent) => agent.id)).toEqual(["branch", "A", "B"])
  })

  it("keeps the first record when duplicate ids have different parents", () => {
    const first = Object.freeze({ id: "child", parentAgentId: "first", name: "original" })
    const tree = buildAgentTree(
      Object.freeze([
        first,
        Object.freeze({ id: "first", name: "parent" }),
        Object.freeze({ id: "second", name: "other" }),
        Object.freeze({ id: "child", parentAgentId: "second", name: "duplicate", busy: true }),
      ]),
    )

    expect(tree.byId.size).toBe(3)
    expect(tree.preOrder.map((node) => node.agent.id)).toEqual(["first", "child", "second"])
    expect(tree.byId.get("child")?.agent).toBe(first)
    expect(tree.parentOf("child")?.name).toBe("parent")
    expect(tree.byId.get("first")?.busyDescendantCount).toBe(0)
    expect(tree.byId.get("second")?.children).toEqual([])
  })

  it("walks a 25,000-node chain at full depth in both traversal orders", () => {
    const input = chain(25_000)
    // Start at the leaf to exercise the entire parent walk.
    const tree = buildAgentTree(input.slice().reverse())
    const root = tree.byId.get("0")
    const leaf = tree.byId.get("24999")

    expect(tree.roots).toEqual([root])
    expect(tree.byId.size).toBe(input.length)
    expect(tree.preOrder).toHaveLength(input.length)
    expect(tree.preOrder.at(-1)).toBe(leaf)
    expect(leaf?.depth).toBe(24_999)
    expect(root?.descendantCount).toBe(24_999)
    expect(root?.busyDescendantCount).toBe(12_499)
    expect(tree.pathTo("24999").every((agent, index) => agent === input[index])).toBe(true)
    expect(tree.pathTo("24999")).toHaveLength(input.length)

    const postOrder = descendantsPostOrder(tree, "0")
    expect(postOrder).toHaveLength(24_999)
    expect(postOrder.every((agent, index) => agent === input[24_999 - index])).toBe(true)
  })
})
