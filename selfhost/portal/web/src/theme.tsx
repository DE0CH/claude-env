// One Radix Themes configuration for the app root AND for every portaled sheet (a portal that
// lands outside the Theme root would lose the theme's CSS variables). Deyao's look rules: a
// commonly used component package used as shipped — these are its documented props, not overrides.
import { createContext, useContext } from "react";
import { Theme } from "@radix-ui/themes";

export const THEME = { radius: "large", accentColor: "blue", grayColor: "slate", panelBackground: "solid", appearance: "inherit" } as const;
// element the sheets portal into (the app's Theme root), so they inherit the theme
export const PortalCtx = createContext<HTMLElement | null>(null);
export const usePortalContainer = () => useContext(PortalCtx) ?? undefined;
export { Theme };
