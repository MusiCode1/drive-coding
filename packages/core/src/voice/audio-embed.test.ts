import { describe, expect, it } from "vitest"
import { resolveAudioEmbed } from "./audio-embed.js"

describe("resolveAudioEmbed", () => {
  it("absolute local audio path", () => {
    expect(resolveAudioEmbed("/tmp/a.mp3", null)).toEqual({
      title: "",
      href: "/tmp/a.mp3",
      uri: "file:///tmp/a.mp3",
    })
  })

  it("relative path resolved against cwd", () => {
    expect(resolveAudioEmbed("./out/clip.mp3", "/home/p")).toEqual({
      title: "",
      href: "./out/clip.mp3",
      uri: "file:///home/p/out/clip.mp3",
    })
  })

  it("non-audio extension → null", () => {
    expect(resolveAudioEmbed("/tmp/a.png", null)).toBeNull()
  })

  it("https URL → null", () => {
    expect(resolveAudioEmbed("https://x/a.mp3", "/c")).toBeNull()
  })

  it("home-relative → null", () => {
    expect(resolveAudioEmbed("~/a.mp3", "/c")).toBeNull()
  })

  it("relative without cwd → null", () => {
    expect(resolveAudioEmbed("rel.mp3", null)).toBeNull()
  })
})
