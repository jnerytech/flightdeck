import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { poll } from "../../../daemon/test/support/helpers.ts";
import { liveScreen, registerDom } from "../dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN } from "../fixtures.ts";
import { sidebarNav } from "../sidebar/helpers.ts";
import { settle } from "../wait.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const sidebar = sidebarNav({ act, fireEvent, screen });
const { AppStore } = await import("../../src/lib/app-store.ts");
const { App } = await import("../../src/ui/App.tsx");
const { breadcrumb } = await import("../../src/features/shell/crumbs.ts");
const { translator } = await import("../../src/i18n/index.ts");
