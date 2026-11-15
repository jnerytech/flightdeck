import { lazy } from "react";

/**
 * The file viewer as a lazy component (#1589). CodeMirror stays out of the entry chunk
 * (bundle-lazy): the viewer loads on the first file opened, from the explorer or a terminal.
 */
export const LazyFileViewer = lazy(() =>
  import("./file-viewer.tsx").then((m) => ({ default: m.FileViewer })),
);
