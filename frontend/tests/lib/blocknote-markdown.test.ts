import { afterEach, describe, mock as nodeMock, test } from "node:test";
import assert from "node:assert/strict";
const mock = nodeMock.fn.bind(nodeMock);
const originalConsoleError = console.error;
import { blocksToMarkdownSafely } from "../../src/lib/blocknote-markdown";

describe("blocksToMarkdownSafely", () => {
  afterEach(() => {
    nodeMock.restoreAll();
    console.error = originalConsoleError;
  });

  test("returns markdown when conversion succeeds", async () => {
    const editor = {
      blocksToMarkdownLossy: mock(async () => "# Summary"),
    };

    const result = await blocksToMarkdownSafely(editor, [] as any, {
      source: "test-success",
    });

    assert.deepEqual(result, {
      markdown: "# Summary",
      ok: true,
    });
    assert.equal(editor.blocksToMarkdownLossy.mock.callCount(), 1);
  });

  test("returns fallback markdown when conversion throws", async () => {
    const error = new Error("conversion failed");
    const editor = {
      blocksToMarkdownLossy: mock(async () => {
        throw error;
      }),
    };
    const consoleError = mock(() => {});
    console.error = consoleError as any;

    const result = await blocksToMarkdownSafely(editor, [{ id: "block-1" }] as any, {
      source: "test-fallback",
      fallbackMarkdown: "existing markdown",
    });

    assert.deepEqual(result, {
      markdown: "existing markdown",
      ok: false,
    });
    assert.equal(consoleError.mock.callCount(), 1);
    assert.deepEqual(consoleError.mock.calls[0].arguments, [
      "Failed to convert BlockNote blocks to markdown",
      {
        source: "test-fallback",
        blocksCount: 1,
        error,
      },
    ]);
  });

  test("omits markdown when conversion throws without fallback", async () => {
    const editor = {
      blocksToMarkdownLossy: mock(async () => {
        throw new Error("conversion failed");
      }),
    };
    console.error = mock(() => {}) as any;

    const result = await blocksToMarkdownSafely(editor, [] as any, {
      source: "test-empty-fallback",
    });

    assert.deepEqual(result, {
      markdown: undefined,
      ok: false,
    });
  });
});
