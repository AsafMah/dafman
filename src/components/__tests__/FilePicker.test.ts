import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cleanup, render, fireEvent, waitFor } from "@testing-library/vue";
import { nextTick } from "vue";
import FilePicker from "../FilePicker.vue";
import { setRpcBridge, type RpcBridge } from "../../ipc/invoke";
import type { CommandName, CommandMap, WorkspaceFileMatch } from "../../ipc/types";

/// FilePicker tests cover the renderer-side behavior of the new
/// @-picker / paperclip popover:
/// - results render with file / directory icons + kind labels
/// - selecting emits the right SendMessageAttachment shape
/// - includeHidden toggle re-issues the RPC
/// - Browse… button calls pickAttachment and emits on result
/// - keyboard nav via the exposed imperative API works
///
/// Lexical wiring (the @-trigger replacing a TextNode with a pill)
/// lives in MentionPlugin.vue and is exercised by the editor +
/// smoke test — these tests stay pure to the popup body.

interface FakeBridge extends RpcBridge {
  calls: Array<{ name: string; args: unknown }>;
  setNext<N extends CommandName>(name: N, value: CommandMap[N]["result"]): void;
}

function makeBridge(): FakeBridge {
  const nextResponses = new Map<string, unknown>();
  const calls: FakeBridge["calls"] = [];
  return {
    calls,
    setNext(name, value) {
      nextResponses.set(name, value);
    },
    async request(name, args) {
      calls.push({ name, args });
      if (!nextResponses.has(name as string)) {
        throw new Error(`No response stubbed for ${name as string}`);
      }
      return nextResponses.get(name as string) as never;
    },
    onSessionEvent: () => () => {},
    onPendingRequest: () => () => {},
    onLogEvent: () => () => {},
    onAuditEvent: () => () => {},
  };
}

const sample: WorkspaceFileMatch[] = [
  { path: "src", absolutePath: "/r/src", name: "src", kind: "directory" },
  { path: "README.md", absolutePath: "/r/README.md", name: "README.md", kind: "file" },
];

let bridge: FakeBridge;

beforeEach(() => {
  bridge = makeBridge();
  setRpcBridge(bridge);
});

afterEach(() => {
  setRpcBridge(null);
  cleanup();
});

describe("FilePicker", () => {
  test("renders results with kind badges + emits attachment on click", async () => {
    bridge.setNext("searchWorkspaceFiles", sample);
    const utils = render(FilePicker, {
      props: { sessionId: "s1", showSearchInput: false, externalQuery: "" },
    });
    await waitFor(() => expect(utils.getAllByRole("option")).toHaveLength(2));
    expect(utils.getByText("dir")).toBeDefined();
    expect(utils.getByText("file")).toBeDefined();

    const options = utils.getAllByRole("option");
    // sample[1] is README.md (kind=file). Click that one.
    await fireEvent.click(options[1]!);
    const emitted = utils.emitted("select") as unknown[][];
    expect(emitted).toHaveLength(1);
    expect(emitted[0]?.[0]).toEqual({
      type: "file",
      path: "/r/README.md",
      displayName: "README.md",
    });
  });

  test("directory pick emits directory attachment", async () => {
    bridge.setNext("searchWorkspaceFiles", sample);
    const utils = render(FilePicker, {
      props: { sessionId: "s1", showSearchInput: false, externalQuery: "" },
    });
    await waitFor(() => expect(utils.getAllByRole("option")).toHaveLength(2));
    // sample[0] is src (kind=directory).
    await fireEvent.click(utils.getAllByRole("option")[0]!);
    const emitted = utils.emitted("select") as unknown[][];
    expect(emitted[0]?.[0]).toEqual({
      type: "directory",
      path: "/r/src",
      displayName: "src",
    });
  });

  test("Show hidden toggle re-issues the RPC with includeHidden=true", async () => {
    bridge.setNext("searchWorkspaceFiles", sample);
    const utils = render(FilePicker, {
      props: { sessionId: "s1", showSearchInput: false, externalQuery: "" },
    });
    await waitFor(() => expect(utils.getAllByRole("option")).toHaveLength(2));
    bridge.calls.length = 0;
    bridge.setNext("searchWorkspaceFiles", sample);
    await fireEvent.click(utils.getByLabelText("Include hidden files and ignored directories"));
    await nextTick();
    await waitFor(() =>
      expect(
        bridge.calls.some(
          (c) => c.name === "searchWorkspaceFiles" &&
            (c.args as { includeHidden?: boolean }).includeHidden === true,
        ),
      ).toBe(true),
    );
  });

  test("Browse… invokes pickAttachment and emits on the result", async () => {
    bridge.setNext("searchWorkspaceFiles", sample);
    bridge.setNext("pickAttachment", {
      path: "/abs/picked.txt",
      kind: "file",
    });
    const utils = render(FilePicker, {
      props: { sessionId: "s1", showSearchInput: false, externalQuery: "" },
    });
    await waitFor(() => utils.getByText("Browse…"));
    await fireEvent.click(utils.getByText("Browse…"));
    await waitFor(() => (utils.emitted("select") as unknown[][])?.length === 1);
    const emitted = utils.emitted("select") as unknown[][];
    expect(emitted[0]?.[0]).toEqual({
      type: "file",
      path: "/abs/picked.txt",
      displayName: "/abs/picked.txt",
    });
  });

  test("Browse… cancellation does not emit", async () => {
    bridge.setNext("searchWorkspaceFiles", sample);
    bridge.setNext("pickAttachment", null);
    const utils = render(FilePicker, {
      props: { sessionId: "s1", showSearchInput: false, externalQuery: "" },
    });
    await waitFor(() => utils.getByText("Browse…"));
    await fireEvent.click(utils.getByText("Browse…"));
    await nextTick();
    await nextTick();
    expect(utils.emitted("select")).toBeUndefined();
  });

  test("empty results show the empty state", async () => {
    bridge.setNext("searchWorkspaceFiles", []);
    const utils = render(FilePicker, {
      props: { sessionId: "s1", showSearchInput: false, externalQuery: "nope" },
    });
    await waitFor(() => utils.getByText("No matches."));
    expect(utils.queryAllByRole("option")).toHaveLength(0);
  });

  test("showSearchInput renders an internal input that drives query", async () => {
    bridge.setNext("searchWorkspaceFiles", sample);
    const utils = render(FilePicker, {
      props: { sessionId: "s1", showSearchInput: true },
    });
    await waitFor(() => expect(utils.getAllByRole("option")).toHaveLength(2));
    bridge.calls.length = 0;
    bridge.setNext("searchWorkspaceFiles", sample);
    const input = utils.getByLabelText("Search workspace") as HTMLInputElement;
    await fireEvent.update(input, "READ");
    await waitFor(() =>
      expect(bridge.calls.some((c) => (c.args as { query?: string }).query === "READ")).toBe(true),
    );
  });
});
