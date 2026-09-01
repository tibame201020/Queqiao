import { Box, Text } from "ink";
import { workstationFloatingModalGeometry, workstationModalWidth, workstationSettingsModalHeight } from "./workstation-modal-style.js";
import { workstationColorChoiceFor, workstationColorChoices, workstationSemanticRoles, type WorkstationPalette } from "./workstation-theme.js";
import { useWorkstationPalette } from "./workstation-theme-ui.js";

export function workstationColorPickerColumns(modalWidth: number): number {
  if (modalWidth >= 88) return 4;
  if (modalWidth >= 66) return 3;
  return 2;
}

function ColorPicker({ selectedIndex, modalWidth }: { selectedIndex: number; modalWidth: number }) {
  const palette = useWorkstationPalette();
  const columns = workstationColorPickerColumns(modalWidth);
  const rows = Math.ceil(workstationColorChoices.length / columns);
  return <Box marginTop={1} flexDirection="column" flexGrow={1} minHeight={0}>
    <Text bold color={palette.accent}>Choose color</Text>
    <Box marginTop={1} flexDirection="column">
      {Array.from({ length: rows }, (_, rowIndex) => (
        <Box key={rowIndex} gap={1}>
          {Array.from({ length: columns }, (_, columnIndex) => {
            const index = rowIndex * columns + columnIndex;
            const choice = workstationColorChoices[index];
            if (!choice) return <Box key={columnIndex} width={20} />;
            const focused = index === selectedIndex;
            return <Box key={choice.id} width={20} flexShrink={0}>
              <Text {...(focused ? { color: palette.accent, bold: true } : {})}>{focused ? "›" : " "}</Text>
              <Text> </Text>
              <Text backgroundColor={choice.value}>    </Text>
              <Text> </Text>
              <Text color={choice.value}>{choice.label}</Text>
            </Box>;
          })}
        </Box>
      ))}
    </Box>
    <Box marginTop={1}><Text dimColor color={palette.muted}>Arrow keys move · Enter choose · Esc back</Text></Box>
  </Box>;
}

export function WorkstationSettingsModal({
  selectedRoleIndex,
  colors,
  pickerOpen,
  pickerIndex,
  terminalWidth,
  terminalHeight,
}: {
  selectedRoleIndex: number;
  colors: WorkstationPalette;
  pickerOpen: boolean;
  pickerIndex: number;
  terminalWidth: number;
  terminalHeight: number;
}) {
  const palette = useWorkstationPalette();
  const width = workstationModalWidth(terminalWidth);
  const height = workstationSettingsModalHeight(terminalHeight);
  const geometry = workstationFloatingModalGeometry(terminalWidth, terminalHeight, width, height, 1, "center");
  const selectedRole = workstationSemanticRoles[Math.min(selectedRoleIndex, workstationSemanticRoles.length - 1)]!;
  return <Box position="absolute" top={geometry.top} left={0} width={terminalWidth} height={geometry.outerHeight} paddingY={geometry.clearance} alignItems="center" justifyContent="center" backgroundColor="black">
    <Box width={width} height={height} flexDirection="column" borderStyle="double" borderColor={palette.modal} borderBackgroundColor="black" backgroundColor="black" paddingX={1} overflowY="hidden">
      <Text bold color={palette.modal}>SETTINGS · Appearance</Text>
      {pickerOpen ? <>
        <Box marginTop={1} flexDirection="column" flexShrink={0}>
          <Text bold color={colors[selectedRole.id]}>{selectedRole.label}</Text>
          <Text dimColor color={palette.muted}>{selectedRole.description}</Text>
        </Box>
        <ColorPicker selectedIndex={pickerIndex} modalWidth={width} />
      </> : <>
        <Box marginTop={1} flexDirection="column" flexShrink={0}>
          <Text bold color={palette.accent}>Semantic colors</Text>
          <Text dimColor color={palette.muted}>Assign a color to each Workstation UI role. Runtime meaning stays fixed; only presentation changes.</Text>
        </Box>
        <Box marginTop={1} flexDirection="column" flexGrow={1} minHeight={0}>
          {workstationSemanticRoles.map((role, index) => {
            const focused = index === selectedRoleIndex;
            const color = colors[role.id];
            const choice = workstationColorChoiceFor(color);
            return <Box key={role.id}>
              <Box width={20} flexShrink={0}><Text bold={focused} {...(focused ? { color: palette.accent } : {})}>{focused ? "› " : "  "}{role.label}</Text></Box>
              <Box width={7} flexShrink={0}><Text backgroundColor={color}>    </Text></Box>
              <Text color={color}>{choice.label}</Text>
            </Box>;
          })}
          <Box marginTop={1} flexDirection="column" flexShrink={0}>
            <Text bold color={colors[selectedRole.id]}>{selectedRole.label}</Text>
            <Text dimColor color={palette.muted}>{selectedRole.description}</Text>
          </Box>
        </Box>
        <Box marginTop={1} flexShrink={0}><Text dimColor><Text color={palette.accent}>↑↓</Text> role · <Text color={palette.accent}>Enter</Text> colors · <Text color={palette.accent}>s</Text> save · <Text color={palette.accent}>Esc</Text> cancel</Text></Box>
      </>}
    </Box>
  </Box>;
}
