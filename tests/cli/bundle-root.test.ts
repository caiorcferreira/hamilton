import { describe, it, expect } from "vitest"
import { resolveBundleRoot, BundleRootNotFoundError } from "../../packages/cli/src/cli/bundle-root.js"

describe("resolveBundleRoot", () => {
  it("resolves from source checkout when no env override and no binary-sibling bundle", () => {
    const sourceDir = "/repo/packages/cli/src/cli"
    const mockEnv = {}
    const mockExecPath = "/usr/local/bin/kepler"
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
    const sourceDir = "/repo/packages/cli/src/cli"
    const mockEnv = {}
    const mockExecPath = "/opt/kepler/bin/kepler"
    const existingPaths = new Set(["/opt/kepler/bundle"])

    const result = resolveBundleRoot({
      env: mockEnv,
      execPath: mockExecPath,
      sourceDir,
      existsSync: (path: string) => existingPaths.has(path),
      realpathSync: (path: string) => path,
    })

    expect(result).toBe("/opt/kepler/bundle")
  })

  it("throws BundleRootNotFoundError when no bundle directory exists", () => {
    const sourceDir = "/repo/packages/cli/src/cli"
    const mockEnv = {}
    const mockExecPath = "/usr/local/bin/kepler"
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
    const sourceDir = "/repo/packages/cli/src/cli"
    const mockEnv = {}
    const mockExecPath = "/usr/local/bin/kepler"
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
      expect(message).toContain("Could not locate the Kepler bundle directory")
      expect(message).toContain("/usr/local/bundle")
      expect(message).toContain("/repo/bundle")
    }
  })

  it("uses KEPLER_BUNDLE_DIR env var when set and path exists", () => {
    const sourceDir = "/repo/packages/cli/src/cli"
    const mockEnv = { KEPLER_BUNDLE_DIR: "/custom/bundle" }
    const mockExecPath = "/usr/local/bin/kepler"
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

  it("KEPLER_BUNDLE_DIR env var takes precedence over other branches", () => {
    const sourceDir = "/repo/packages/cli/src/cli"
    const mockEnv = { KEPLER_BUNDLE_DIR: "/custom/bundle" }
    const mockExecPath = "/opt/kepler/bin/kepler"
    const existingPaths = new Set(["/custom/bundle", "/opt/kepler/bundle", "/repo/bundle"])

    const result = resolveBundleRoot({
      env: mockEnv,
      execPath: mockExecPath,
      sourceDir,
      existsSync: (path: string) => existingPaths.has(path),
      realpathSync: (path: string) => path,
    })

    expect(result).toBe("/custom/bundle")
  })

  it("falls through to next branch when KEPLER_BUNDLE_DIR points to non-existent directory", () => {
    const sourceDir = "/repo/packages/cli/src/cli"
    const mockEnv = { KEPLER_BUNDLE_DIR: "/custom/nonexistent" }
    const mockExecPath = "/usr/local/bin/kepler"
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

  it("still lists non-existent KEPLER_BUNDLE_DIR in checked paths", () => {
    const sourceDir = "/repo/packages/cli/src/cli"
    const mockEnv = { KEPLER_BUNDLE_DIR: "/custom/nonexistent" }
    const mockExecPath = "/usr/local/bin/kepler"
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
