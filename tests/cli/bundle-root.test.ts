import { describe, it, expect } from "vitest"
import { resolveBundleRoot, BundleRootNotFoundError } from "../../src/cli/bundle-root.js"

describe("resolveBundleRoot", () => {
  it("resolves from source checkout when no env override and no binary-sibling bundle", () => {
    const sourceDir = "/repo/src/cli"
    const mockEnv = {}
    const mockExecPath = "/usr/local/bin/hamilton"
    const existingPaths = new Set(["/repo/bundle"])

    const result = resolveBundleRoot({
      env: mockEnv,
      execPath: mockExecPath,
      sourceDir,
      existsSync: (path: string) => existingPaths.has(path),
      realpathSync: (path: string) => path,
    })

    expect(result).toBe("/repo/bundle")
  })

  it("resolves from binary-sibling bundle when available", () => {
    const sourceDir = "/repo/src/cli"
    const mockEnv = {}
    const mockExecPath = "/opt/hamilton/bin/hamilton"
    const existingPaths = new Set(["/opt/hamilton/bundle"])

    const result = resolveBundleRoot({
      env: mockEnv,
      execPath: mockExecPath,
      sourceDir,
      existsSync: (path: string) => existingPaths.has(path),
      realpathSync: (path: string) => path,
    })

    expect(result).toBe("/opt/hamilton/bundle")
  })

  it("throws BundleRootNotFoundError when no bundle directory exists", () => {
    const sourceDir = "/repo/src/cli"
    const mockEnv = {}
    const mockExecPath = "/usr/local/bin/hamilton"
    const existingPaths = new Set<string>()

    expect(() => {
      resolveBundleRoot({
        env: mockEnv,
        execPath: mockExecPath,
        sourceDir,
        existsSync: (path: string) => existingPaths.has(path),
        realpathSync: (path: string) => path,
      })
    }).toThrow(BundleRootNotFoundError)
  })

  it("BundleRootNotFoundError lists all checked paths", () => {
    const sourceDir = "/repo/src/cli"
    const mockEnv = {}
    const mockExecPath = "/usr/local/bin/hamilton"
    const existingPaths = new Set<string>()

    try {
      resolveBundleRoot({
        env: mockEnv,
        execPath: mockExecPath,
        sourceDir,
        existsSync: (path: string) => existingPaths.has(path),
        realpathSync: (path: string) => path,
      })
      expect.fail("Should have thrown")
    } catch (e) {
      expect(e).toBeInstanceOf(BundleRootNotFoundError)
      const error = e as BundleRootNotFoundError
      const message = error.message
      expect(message).toContain("Could not locate the Hamilton bundle directory")
      expect(message).toContain("/usr/local/bundle")
      expect(message).toContain("/repo/bundle")
    }
  })

  it("uses HAMILTON_BUNDLE_DIR env var when set and path exists", () => {
    const sourceDir = "/repo/src/cli"
    const mockEnv = { HAMILTON_BUNDLE_DIR: "/custom/bundle" }
    const mockExecPath = "/usr/local/bin/hamilton"
    const existingPaths = new Set(["/custom/bundle"])

    const result = resolveBundleRoot({
      env: mockEnv,
      execPath: mockExecPath,
      sourceDir,
      existsSync: (path: string) => existingPaths.has(path),
      realpathSync: (path: string) => path,
    })

    expect(result).toBe("/custom/bundle")
  })

  it("HAMILTON_BUNDLE_DIR env var takes precedence over other branches", () => {
    const sourceDir = "/repo/src/cli"
    const mockEnv = { HAMILTON_BUNDLE_DIR: "/custom/bundle" }
    const mockExecPath = "/opt/hamilton/bin/hamilton"
    const existingPaths = new Set(["/custom/bundle", "/opt/hamilton/bundle", "/repo/bundle"])

    const result = resolveBundleRoot({
      env: mockEnv,
      execPath: mockExecPath,
      sourceDir,
      existsSync: (path: string) => existingPaths.has(path),
      realpathSync: (path: string) => path,
    })

    expect(result).toBe("/custom/bundle")
  })

  it("falls through to next branch when HAMILTON_BUNDLE_DIR points to non-existent directory", () => {
    const sourceDir = "/repo/src/cli"
    const mockEnv = { HAMILTON_BUNDLE_DIR: "/custom/nonexistent" }
    const mockExecPath = "/usr/local/bin/hamilton"
    const existingPaths = new Set(["/repo/bundle"])

    const result = resolveBundleRoot({
      env: mockEnv,
      execPath: mockExecPath,
      sourceDir,
      existsSync: (path: string) => existingPaths.has(path),
      realpathSync: (path: string) => path,
    })

    expect(result).toBe("/repo/bundle")
  })

  it("still lists non-existent HAMILTON_BUNDLE_DIR in checked paths", () => {
    const sourceDir = "/repo/src/cli"
    const mockEnv = { HAMILTON_BUNDLE_DIR: "/custom/nonexistent" }
    const mockExecPath = "/usr/local/bin/hamilton"
    const existingPaths = new Set<string>()

    try {
      resolveBundleRoot({
        env: mockEnv,
        execPath: mockExecPath,
        sourceDir,
        existsSync: (path: string) => existingPaths.has(path),
        realpathSync: (path: string) => path,
      })
      expect.fail("Should have thrown")
    } catch (e) {
      expect(e).toBeInstanceOf(BundleRootNotFoundError)
      const error = e as BundleRootNotFoundError
      const message = error.message
      expect(message).toContain("/custom/nonexistent")
      expect(message).toContain("/usr/local/bundle")
      expect(message).toContain("/repo/bundle")
    }
  })
})
