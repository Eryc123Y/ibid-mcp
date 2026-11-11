import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, expect, it, vi } from "vitest";
const mocked = vi.hoisted(() => ({ spawn: vi.fn(), createInterface: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: mocked.spawn }));
vi.mock("node:readline/promises", () => ({
  createInterface: mocked.createInterface,
}));
import { runWrangler, prompt } from "../cli/runtime";
afterEach(() => vi.restoreAllMocks());
it("resolves the installed Wrangler executable and captures output without spawning a real process", async () => {
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
  });
  mocked.spawn.mockReturnValueOnce(child);
  const result = runWrangler(["whoami"]);
  expect(mocked.spawn).toHaveBeenCalledWith(
    process.execPath,
    [expect.stringMatching(/wrangler\/bin\/wrangler.js$/), "whoami"],
    expect.anything(),
  );
  child.stdout.write("Authenticated");
  child.stderr.write("private diagnostics");
  child.emit("close", 0);
  expect(await result).toBe("Authenticated");
});
it("sanitizes spawn and command failures", async () => {
  for (const event of ["error", "close"]) {
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
    });
    mocked.spawn.mockReturnValueOnce(child);
    const result = runWrangler(["secret", "bulk", "private.json"]);
    child.emit(event, event === "error" ? new Error("do not echo") : 1);
    await expect(result).rejects.toThrow(
      event === "error" ? "Unable to start" : "failed",
    );
  }
});
it("hides secret prompt echoes, allows ordinary prompts, and refuses noninteractive input", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
  const write = vi
    .spyOn(process.stdout, "write")
    .mockImplementation(() => true);
  try {
    Object.defineProperty(process.stdin, "isTTY", {
      configurable: true,
      value: true,
    });
    mocked.createInterface.mockImplementation(({ output }) => ({
      question: async () => {
        output.write("private-input");
        return "answer";
      },
      close: vi.fn(),
    }));
    expect(await prompt("Key", true)).toBe("answer");
    expect(write.mock.calls.some(([s]) => String(s) === "private-input")).toBe(
      false,
    );
    await prompt("Name");
    expect(write.mock.calls.some(([s]) => String(s) === "private-input")).toBe(
      true,
    );
    Object.defineProperty(process.stdin, "isTTY", {
      configurable: true,
      value: false,
    });
    await expect(prompt("Key", true)).rejects.toThrow("interactive");
  } finally {
    if (descriptor) Object.defineProperty(process.stdin, "isTTY", descriptor);
    else delete (process.stdin as { isTTY?: boolean }).isTTY;
  }
});
