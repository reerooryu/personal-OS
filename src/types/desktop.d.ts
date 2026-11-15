/** Exposed by electron/preload.cjs in the desktop app. Absent in a browser. */
interface Window {
  ascend?: {
    desktop: boolean;
    hideQuick: () => void;
    chooseFolder?: (defaultPath?: string) => Promise<string | null>;
  };
}
