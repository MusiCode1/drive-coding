// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest"
import { enhanceFileLinks } from "./enhance-file-links"
import { enhanceRemoteImages, type RemoteImageParams } from "./enhance-remote-images"

function mount(html: string, over: Partial<RemoteImageParams> = {}) {
  const node = document.createElement("div")
  node.innerHTML = html
  document.body.append(node)
  const params: RemoteImageParams = {
    text: node.textContent ?? "",
    label: "Load image",
    ...over,
  }
  const handle = enhanceRemoteImages(node, params)
  return { node, handle, params }
}

beforeEach(() => {
  document.body.innerHTML = ""
})

describe("enhanceRemoteImages", () => {
  it("turns canonical remote markdown into a load button", () => {
    const { node } = mount("<p>![alt](https://example.com/x.png)</p>")
    const btn = node.querySelector<HTMLElement>("[data-remote-src]")
    expect(btn).not.toBeNull()
    expect(btn?.dataset["remoteSrc"]).toBe("https://example.com/x.png")
    expect(btn?.dataset["remoteAlt"]).toBe("alt")
    expect(btn?.textContent).toBe("Load image")
  })

  it("click replaces button with img (no-referrer)", () => {
    const { node } = mount("<p>![a](https://picsum.photos/200)</p>")
    const btn = node.querySelector<HTMLElement>("[data-remote-src]")
    btn?.click()
    const img = node.querySelector("img")
    expect(img).not.toBeNull()
    expect(img?.getAttribute("src")).toBe("https://picsum.photos/200")
    expect(img?.referrerPolicy).toBe("no-referrer")
    expect(node.querySelector("[data-remote-src]")).toBeNull()
  })

  it("does not touch markdown inside inline code", () => {
    const { node } = mount("<p><code>![a](https://x.png)</code></p>")
    expect(node.querySelector("[data-remote-src]")).toBeNull()
  })

  it("does not touch markdown inside pre/code block", () => {
    const { node } = mount("<pre><code>![a](https://x.png)</code></pre>")
    expect(node.querySelector("[data-remote-src]")).toBeNull()
  })

  it("update after innerHTML replacement re-enhances", () => {
    const { node, handle, params } = mount("<p>![a](https://a.test/1.png)</p>")
    node.innerHTML = "<p>![b](https://b.test/2.png)</p>"
    handle?.update?.({ ...params, text: "![b](https://b.test/2.png)" })
    expect(node.querySelector("[data-remote-src]")?.dataset["remoteSrc"]).toBe(
      "https://b.test/2.png",
    )
  })

  it("destroy removes click handler", () => {
    const { node, handle } = mount("<p>![a](https://x.test/p.png)</p>")
    handle?.destroy?.()
    node.querySelector<HTMLElement>("[data-remote-src]")?.click()
    expect(node.querySelector("img")).toBeNull()
  })

  it("cross-case: remote image with file path in alt gets button, not file-link", () => {
    const node = document.createElement("div")
    node.innerHTML = "<p>![see AGENTS.md](https://x.png)</p>"
    document.body.append(node)

    const remoteParams: RemoteImageParams = {
      text: node.textContent ?? "",
      label: "Load image",
    }
    const remoteHandle = enhanceRemoteImages(node, remoteParams)

    enhanceFileLinks(node, {
      text: node.textContent ?? "",
      cwd: "/home/u/proj",
      onOpen: vi.fn(),
      label: "file",
      enabled: true,
    })

    expect(node.querySelector("[data-remote-src]")).not.toBeNull()
    const remoteBtn = node.querySelector("[data-remote-src]")
    expect(remoteBtn?.querySelector(".file-link")).toBeNull()
    expect(remoteBtn?.closest(".file-link")).toBeNull()
    expect(node.querySelector(".file-link")).toBeNull()

    remoteHandle.destroy?.()
  })
})
