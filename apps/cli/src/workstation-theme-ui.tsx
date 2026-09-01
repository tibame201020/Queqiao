import { createContext, useContext } from "react";
import { resolveWorkstationPalette, type WorkstationPalette } from "./workstation-theme.js";

const WorkstationThemeContext = createContext<WorkstationPalette>(resolveWorkstationPalette());

export function WorkstationThemeProvider({ palette, children }: { palette: WorkstationPalette; children: React.ReactNode }) {
  return <WorkstationThemeContext.Provider value={palette}>{children}</WorkstationThemeContext.Provider>;
}

export function useWorkstationPalette(): WorkstationPalette {
  return useContext(WorkstationThemeContext);
}
