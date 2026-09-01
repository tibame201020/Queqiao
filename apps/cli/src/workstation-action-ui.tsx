import { Box, Text } from "ink";
import { WorkstationPromptPanel } from "./workstation-prompt-ui.js";
import { WorkstationScrollViewport } from "./workstation-scroll.js";
import { actionOutcome, type WorkstationActionOutcome } from "./workstation-action-outcome.js";
import { workstationActionModalHeight, workstationFloatingModalGeometry, workstationModalChromeColor, workstationModalMaxHeight, workstationModalWidth } from "./workstation-modal-style.js";
import { resolveWorkstationPalette, type WorkstationPalette } from "./workstation-theme.js";
import { useWorkstationPalette } from "./workstation-theme-ui.js";

export type WorkstationTransactionDisplayAction = {
  label: string;
  disabledReason?: string;
  effect?: string;
};

export type WorkstationTransactionDisplay = {
  action: WorkstationTransactionDisplayAction;
  targetTitle: string;
  phase: "running" | "result";
  outcome?: WorkstationActionOutcome;
};

type Prompt = React.ComponentProps<typeof WorkstationPromptPanel>["prompt"];

function optionalColor(color: string | undefined): { color?: string } {
  return color ? { color } : {};
}

function outcomeColor(status: WorkstationActionOutcome["status"], palette: WorkstationPalette = resolveWorkstationPalette()): string {
  if (status === "success") return palette.success;
  if (status === "warning") return palette.warning;
  if (status === "error") return palette.danger;
  return palette.muted;
}

function outcomeGlyph(status: WorkstationActionOutcome["status"]): string {
  if (status === "success") return "✓";
  if (status === "warning" || status === "error") return "!";
  return "○";
}

function ActionTransactionContent({
  transaction,
  prompt,
  resultScrollOffset,
  onResultScrollOffsetChange,
  onResultMaxScrollOffsetChange,
  compact,
}: {
  transaction: WorkstationTransactionDisplay;
  prompt: Prompt | undefined;
  resultScrollOffset: number;
  onResultScrollOffsetChange: (offset: number) => void;
  onResultMaxScrollOffsetChange: (offset: number) => void;
  compact: boolean;
}) {
  const palette = useWorkstationPalette();
  if (prompt) return <Box flexDirection="column" flexGrow={1} minHeight={0}>
    <Box flexDirection="column" flexShrink={0}>
      <Text bold color={palette.modal}>ACTION · {transaction.action.label}</Text>
      <Box {...(!compact ? { marginTop: 1 } : {})}><Box width={10} flexShrink={0}><Text dimColor color={palette.muted}>Target</Text></Box><Box flexGrow={1} minWidth={0}><Text wrap="truncate-end">{transaction.targetTitle}</Text></Box></Box>
      {!compact && transaction.action.effect ? <Box><Box width={10} flexShrink={0}><Text dimColor color={palette.muted}>Purpose</Text></Box><Box flexGrow={1} minWidth={0}><Text wrap="truncate-end">{transaction.action.effect}</Text></Box></Box> : null}
    </Box>
    <Box marginTop={1} flexDirection="column" flexGrow={1} minHeight={0}><WorkstationPromptPanel prompt={prompt} targetTitle={transaction.targetTitle} compact={compact} /></Box>
  </Box>;

  if (transaction.phase === "running") return <Box flexDirection="column">
    <Text bold color={palette.modal}>ACTION · {transaction.action.label}</Text>
    <Text>Target: {transaction.targetTitle}</Text>
    {transaction.action.effect ? <Box marginTop={1}><Text>{transaction.action.effect}</Text></Box> : null}
    <Box marginTop={1}><Text color={palette.accent}>… Working</Text></Box>
  </Box>;

  const outcome = transaction.outcome ?? actionOutcome("error", "Action result is unavailable");
  const color = outcomeColor(outcome.status, palette);
  return <Box flexDirection="column" flexGrow={1} minHeight={0} overflowY="hidden">
    <WorkstationScrollViewport
      offset={resultScrollOffset}
      onOffsetChange={onResultScrollOffsetChange}
      onMaxOffsetChange={onResultMaxScrollOffsetChange}
    >
      <Text bold color={color}>{outcomeGlyph(outcome.status)} {outcome.title}</Text>
      <Text dimColor color={palette.muted}>Target: {transaction.targetTitle}</Text>
      {outcome.summary ? <Box marginTop={1}><Text>{outcome.summary}</Text></Box> : null}
      {outcome.details?.length ? <Box flexDirection="column" marginTop={1}><Text bold>Details</Text>{outcome.details.map((detail, index) => <Box key={`${detail.label}:${index}`}><Box width={18} flexShrink={0}><Text>{detail.label}</Text></Box><Box flexGrow={1} minWidth={0}><Text {...optionalColor(detail.tone === "warning" ? palette.warning : detail.tone === "danger" ? palette.danger : undefined)}>{detail.value}</Text></Box></Box>)}</Box> : null}
      {outcome.sideEffects?.length ? <Box flexDirection="column" marginTop={1}><Text bold>Side effects</Text>{outcome.sideEffects.map((detail, index) => <Text key={`${detail.label}:${index}`}><Text {...optionalColor(detail.tone === "success" ? palette.success : detail.tone === "warning" ? palette.warning : undefined)}>{detail.label}</Text> · {detail.value}</Text>)}</Box> : null}
      {outcome.remediation?.length ? <Box flexDirection="column" marginTop={1}><Text bold>Next</Text>{outcome.remediation.map((line, index) => <Text key={`${index}:${line}`} color={palette.warning}>• {line}</Text>)}</Box> : null}
    </WorkstationScrollViewport>
    <Box flexShrink={0} marginTop={1}><Text dimColor color={palette.muted}>↑↓ scroll · Enter / i / Esc · back to Info</Text></Box>
  </Box>;
}

export function WorkstationActionModal({
  transaction,
  prompt,
  terminalWidth,
  terminalHeight,
  resultScrollOffset,
  onResultScrollOffsetChange,
  onResultMaxScrollOffsetChange,
}: {
  transaction: WorkstationTransactionDisplay;
  prompt: Prompt | undefined;
  terminalWidth: number;
  terminalHeight: number;
  resultScrollOffset: number;
  onResultScrollOffsetChange: (offset: number) => void;
  onResultMaxScrollOffsetChange: (offset: number) => void;
}) {
  const palette = useWorkstationPalette();
  const width = workstationModalWidth(terminalWidth);
  const maxHeight = workstationModalMaxHeight(terminalHeight);
  const modalHeight = workstationActionModalHeight(terminalHeight, prompt?.kind, transaction.phase);
  const geometry = workstationFloatingModalGeometry(terminalWidth, terminalHeight, width, modalHeight);
  return <Box
    position="absolute"
    top={geometry.top}
    left={geometry.left}
    width={geometry.outerWidth}
    height={geometry.outerHeight}
    paddingX={geometry.clearance}
    paddingY={geometry.clearance}
    backgroundColor="black"
  >
    <Box
      width={width}
      height={modalHeight}
      flexDirection="column"
      borderStyle="double"
      borderColor={palette.modal}
      borderBackgroundColor="black"
      backgroundColor="black"
      paddingX={1}
      paddingY={0}
      overflowY="hidden"
    >
      <ActionTransactionContent
        transaction={transaction}
        prompt={prompt}
        resultScrollOffset={resultScrollOffset}
        onResultScrollOffsetChange={onResultScrollOffsetChange}
        onResultMaxScrollOffsetChange={onResultMaxScrollOffsetChange}
        compact={terminalHeight < 26}
      />
    </Box>
  </Box>;
}

export const workstationActionUiInternals = { outcomeColor, outcomeGlyph, modalWidth: workstationModalWidth, modalMaxHeight: workstationModalMaxHeight, modalChromeColor: workstationModalChromeColor };
