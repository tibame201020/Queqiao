import { Box, Text } from "ink";
import { WorkstationScrollViewport } from "./workstation-scroll.js";
import {
  workstationDetailModalHeight,
  workstationFloatingModalGeometry,
  workstationHelpModalHeight,
  workstationModalChromeColor,
  workstationModalWidth,
} from "./workstation-modal-style.js";
import type { WorkstationInspectorViewModel, WorkstationListSection, WorkstationRuntimeSection } from "./workstation-inspector.js";
import type { WorkstationDiagnosticEntry, WorkstationDiagnosticsViewModel } from "./workstation-diagnostics.js";
import { useWorkstationPalette } from "./workstation-theme-ui.js";

export type WorkstationDetailTab = { key: string; label: string };

export function detailedInfoTabs(model: WorkstationInspectorViewModel): WorkstationDetailTab[] {
  if (model.kind === "gateway") return [
    { key: "status", label: "Status" },
    { key: "info", label: "Info" },
    { key: "workers", label: "Workers" },
  ];
  if (model.kind === "worker") return [
    { key: "status", label: "Status" },
    { key: "info", label: "Info" },
    { key: "workspaces", label: "Workspaces" },
    { key: "extensions", label: "Extensions" },
    { key: "gateways", label: "Gateways" },
  ];
  if (model.kind === "workspace") return [
    { key: "info", label: "Info" },
    { key: "access", label: "Access" },
  ];
  if (model.kind === "profile") return [
    { key: "info", label: "Info" },
    { key: "tools", label: "Tools" },
    { key: "commands", label: "Commands" },
  ];
  if (model.kind === "extension") return [
    { key: "info", label: "Info" },
    { key: "workers", label: "Workers" },
  ];
  return [
    { key: "summary", label: "Summary" },
    { key: "core", label: "Core" },
    { key: "routing", label: "Routing" },
    { key: "extensions", label: "Extensions" },
    { key: "warnings", label: "Warnings" },
  ];
}

function DetailField({ label, children }: { label: string; children: React.ReactNode }) {
  const palette = useWorkstationPalette();
  return <Box>
    <Box width={18} flexShrink={0}><Text color={palette.accent}>{label}</Text></Box>
    <Box flexGrow={1} minWidth={0}><Text wrap="wrap">{children}</Text></Box>
  </Box>;
}

function RuntimeDetail({ runtime }: { runtime: WorkstationRuntimeSection }) {
  const palette = useWorkstationPalette();
  if (runtime.state !== "ready") return <Text color={runtime.state === "error" ? palette.danger : palette.muted}>{runtime.state === "error" ? "!" : "…"} {runtime.message}</Text>;
  const health = !runtime.active
    ? { text: "○ stopped", color: palette.muted }
    : runtime.health.healthy
      ? { text: "✓ healthy", color: palette.success }
      : runtime.health.reachable
        ? { text: "! degraded", color: palette.warning }
        : { text: "! unreachable", color: palette.danger };
  return <Box flexDirection="column">
    <DetailField label="Active">{runtime.active ? "Yes" : "No"}</DetailField>
    <DetailField label="Managed">{runtime.managed ? "Yes" : "No"}</DetailField>
    {runtime.pid ? <DetailField label="PID">{runtime.pid}</DetailField> : null}
    <DetailField label="Health"><Text color={health.color}>{health.text}</Text>{runtime.health.status ? ` · HTTP ${runtime.health.status}` : ""}</DetailField>
    <DetailField label="Identity match">{runtime.health.identityMatches ? "Yes" : "No"}</DetailField>
    {runtime.health.error ? <DetailField label="Error"><Text color={palette.warning}>{runtime.health.error}</Text></DetailField> : null}
  </Box>;
}

function ListSection<T>({ section, empty, render }: { section: WorkstationListSection<T>; empty: string; render: (item: T, index: number) => React.ReactNode }) {
  const palette = useWorkstationPalette();
  if (section.state !== "ready") return <Text color={section.state === "error" ? palette.warning : palette.muted}>{section.state === "error" ? "!" : "…"} {section.message}</Text>;
  if (!section.items.length) return <Text dimColor color={palette.muted}>{empty}</Text>;
  return <Box flexDirection="column">{section.items.map(render)}</Box>;
}

function DiagnosticLine({ entry }: { entry: WorkstationDiagnosticEntry }) {
  const palette = useWorkstationPalette();
  const color = entry.state === "healthy" ? palette.success : entry.state === "error" ? palette.danger : entry.state === "stopped" ? palette.muted : palette.warning;
  const glyph = entry.state === "healthy" ? "✓" : entry.state === "stopped" ? "○" : "!";
  return <Box flexDirection="column" marginBottom={1}>
    <Text><Text color={color}>{glyph}</Text> {entry.label} · {entry.summary}</Text>
    {entry.detail ? <Text dimColor color={palette.muted}>  {entry.detail}</Text> : null}
    {entry.remediation ? <Text color={palette.warning}>  Next · {entry.remediation}</Text> : null}
  </Box>;
}

function DiagnosticsTab({ diagnostics, tab }: { diagnostics: WorkstationDiagnosticsViewModel | undefined; tab: string }) {
  const palette = useWorkstationPalette();
  if (!diagnostics) return <Text dimColor color={palette.muted}>Diagnostics have not been loaded yet.</Text>;
  if (tab === "summary") return <Box flexDirection="column">
    <Text bold color={diagnostics.ok ? palette.success : palette.warning}>{diagnostics.ok ? "✓ HEALTHY" : `! ${diagnostics.warnings.length} ISSUE${diagnostics.warnings.length === 1 ? "" : "S"}`}</Text>
    <DetailField label="Core checks">{diagnostics.core.length}</DetailField>
    <DetailField label="Routes">{diagnostics.routing.length}</DetailField>
    <DetailField label="Warnings">{diagnostics.warnings.length}</DetailField>
  </Box>;
  if (tab === "core") return <Box flexDirection="column">{diagnostics.core.length ? diagnostics.core.map((entry) => <DiagnosticLine key={entry.key} entry={entry} />) : <Text dimColor color={palette.muted}>No configured runtimes.</Text>}</Box>;
  if (tab === "routing") return <Box flexDirection="column">{diagnostics.routing.length ? diagnostics.routing.map((entry) => <DiagnosticLine key={entry.key} entry={entry} />) : <Text dimColor color={palette.muted}>No routing checks reported.</Text>}</Box>;
  if (tab === "extensions") return <Box flexDirection="column">
    <Text color={diagnostics.extensions.state === "healthy" ? palette.success : palette.warning}>{diagnostics.extensions.state === "healthy" ? "✓" : "!"} {diagnostics.extensions.summary}</Text>
    {diagnostics.extensions.extensionCount !== undefined ? <DetailField label="Extensions">{diagnostics.extensions.extensionCount}</DetailField> : null}
    {diagnostics.extensions.workerCount !== undefined ? <DetailField label="Workers">{diagnostics.extensions.workerCount}</DetailField> : null}
    {diagnostics.extensions.issues.map((issue, index) => <Text key={`${index}:${issue}`} color={palette.warning}>• {issue}</Text>)}
  </Box>;
  return <Box flexDirection="column">{diagnostics.warnings.length ? diagnostics.warnings.map((warning) => <Box key={warning.key} flexDirection="column" marginBottom={1}><Text color={palette.warning}>! {warning.source} · {warning.summary}</Text>{warning.remediation ? <Text>  Next · {warning.remediation}</Text> : null}</Box>) : <Text color={palette.success}>✓ No warnings</Text>}</Box>;
}

function DetailedInfoBody({ model, tab }: { model: WorkstationInspectorViewModel; tab: string }) {
  const palette = useWorkstationPalette();
  if (model.kind === "gateway") {
    if (tab === "status") return <RuntimeDetail runtime={model.runtime} />;
    if (tab === "info") return <Box flexDirection="column">
      <DetailField label="Gateway">{model.title}</DetailField>
      <DetailField label="Lifecycle"><Text color={model.running ? palette.success : palette.muted}>{model.running ? "Running" : "Stopped"}</Text></DetailField>
      <DetailField label="Managed">{model.managed ? "Yes" : "No"}</DetailField>
      <DetailField label="Public URL">{model.publicUrl ?? "—"}</DetailField>
      <DetailField label="Service">{model.servicePort ? `:${model.servicePort}` : "—"}</DetailField>
      <DetailField label="Management">{model.managementPort ? `:${model.managementPort}` : "—"}</DetailField>
      <DetailField label="Worker session">{model.workerSessionMode === "remote" ? "Network · TLS gRPC" : "Loopback gRPC"}</DetailField>
      {model.workerSessionTarget ? <DetailField label="Session target">{model.workerSessionTarget}</DetailField> : null}
    </Box>;
    return <ListSection section={model.workers} empty="No enrolled Workers." render={(worker) => <Box key={worker.workerId} flexDirection="column" marginBottom={1}><Text bold color={palette.accent}>{worker.environmentId}</Text><DetailField label="Worker ID">{worker.workerId}</DetailField><DetailField label="Endpoint">{worker.endpoint ?? "—"}</DetailField></Box>} />;
  }

  if (model.kind === "worker") {
    if (tab === "status") return <RuntimeDetail runtime={model.runtime} />;
    if (tab === "info") return <Box flexDirection="column"><DetailField label="Worker">{model.title}</DetailField><DetailField label="Lifecycle"><Text color={model.running ? palette.success : palette.muted}>{model.running ? "Running" : "Stopped"}</Text></DetailField><DetailField label="Managed">{model.managed ? "Yes" : "No"}</DetailField><DetailField label="Endpoint">{model.endpoint ?? "—"}</DetailField><DetailField label="Local control">HTTP</DetailField><DetailField label="gRPC session">{model.reverseSessionTarget ? "Configured" : "Not configured"}</DetailField>{model.reverseSessionTarget ? <DetailField label="gRPC target">{model.reverseSessionTarget}</DetailField> : null}</Box>;
    if (tab === "workspaces") return <Box flexDirection="column">{model.workspaces.length ? model.workspaces.map((workspace) => <Box key={workspace.id} flexDirection="column" marginBottom={1}><Text bold color={palette.accent}>{workspace.displayName}</Text><DetailField label="ID">{workspace.id}</DetailField><DetailField label="Root">{workspace.root}</DetailField><DetailField label="Profile">{workspace.profile}</DetailField></Box>) : <Text dimColor color={palette.muted}>No Workspaces.</Text>}</Box>;
    if (tab === "extensions") return <Box flexDirection="column">{model.extensions.length ? model.extensions.map((extension) => <Box key={extension.extensionId} flexDirection="column" marginBottom={1}><Text bold color={palette.accent}>{extension.displayName}</Text><DetailField label="ID">{extension.extensionId}</DetailField><DetailField label="Version">{extension.version}</DetailField></Box>) : <Text dimColor color={palette.muted}>No attached Extensions.</Text>}</Box>;
    return <ListSection section={model.gateways} empty="No Gateway relationships." render={(gateway) => <Box key={gateway.name} flexDirection="column" marginBottom={1}><Text bold color={palette.accent}>{gateway.name}</Text><DetailField label="Endpoint">{gateway.endpoint ?? "—"}</DetailField></Box>} />;
  }

  if (model.kind === "workspace") {
    if (tab === "info") return <Box flexDirection="column"><DetailField label="Workspace">{model.title}</DetailField><DetailField label="ID">{model.workspaceId}</DetailField><DetailField label="Worker">{model.workerName}</DetailField><DetailField label="Root">{model.root}</DetailField></Box>;
    return <Box flexDirection="column"><DetailField label="Profile">{model.profile}</DetailField><DetailField label="Semantics">Copied on apply</DetailField><Text dimColor color={palette.muted}>Access Profile changes do not live-update this Workspace.</Text></Box>;
  }

  if (model.kind === "profile") {
    if (tab === "info") return <Box flexDirection="column"><DetailField label="Profile">{model.title}</DetailField><DetailField label="Type">{model.builtin ? "Built-in · immutable" : "Custom"}</DetailField><DetailField label="Semantics">Detached template</DetailField></Box>;
    if (tab === "tools") return <Box flexDirection="column">{model.tools.length ? model.tools.map((tool) => <Text key={tool}><Text color={palette.accent}>•</Text> {tool}</Text>) : <Text dimColor color={palette.muted}>No tools.</Text>}</Box>;
    return <Box flexDirection="column">{model.allowedExecutables.length ? model.allowedExecutables.map((command) => <Text key={command}><Text color={palette.accent}>•</Text> {command}</Text>) : <Text dimColor color={palette.muted}>No allowed executables.</Text>}</Box>;
  }

  if (model.kind === "extension") {
    if (tab === "info") return <Box flexDirection="column"><DetailField label="Extension">{model.title}</DetailField><DetailField label="ID">{model.extensionId}</DetailField><DetailField label="Version">{model.version}</DetailField><DetailField label="Package">{model.package}</DetailField></Box>;
    return <Box flexDirection="column">{model.attachments.length ? model.attachments.map((worker) => <Text key={worker.workerName}><Text color={worker.attached ? palette.success : palette.muted}>{worker.attached ? "●" : "○"}</Text> {worker.workerName} · {worker.attached ? "attached" : "not attached"}</Text>) : <Text dimColor color={palette.muted}>No Worker attachment records.</Text>}</Box>;
  }

  return <DiagnosticsTab diagnostics={model.diagnostics} tab={tab} />;
}

function ModalFooter({ detail = false }: { detail?: boolean }) {
  const palette = useWorkstationPalette();
  return <Text dimColor>
    {detail ? <><Text color={palette.accent}>←→</Text> tabs · <Text color={palette.accent}>↑↓/PgUp/PgDn/Home/End</Text> scroll · </> : null}
    <Text color={palette.accent}>i/Esc</Text> close
  </Text>;
}

export function WorkstationDetailedInfoModal({
  model,
  tabIndex,
  terminalWidth,
  terminalHeight,
  scrollOffset,
  onScrollOffsetChange,
  onMaxScrollOffsetChange,
}: {
  model: WorkstationInspectorViewModel;
  tabIndex: number;
  terminalWidth: number;
  terminalHeight: number;
  scrollOffset: number;
  onScrollOffsetChange: (offset: number) => void;
  onMaxScrollOffsetChange: (offset: number) => void;
}) {
  const palette = useWorkstationPalette();
  const tabs = detailedInfoTabs(model);
  const index = Math.min(Math.max(0, tabIndex), tabs.length - 1);
  const active = tabs[index]!;
  const width = workstationModalWidth(terminalWidth);
  const height = workstationDetailModalHeight(terminalHeight);
  const geometry = workstationFloatingModalGeometry(terminalWidth, terminalHeight, width, height, 1, "center");
  return <Box position="absolute" top={geometry.top} left={0} width={terminalWidth} height={geometry.outerHeight} paddingY={geometry.clearance} alignItems="center" justifyContent="center" backgroundColor="black">
    <Box width={width} height={height} flexDirection="column" borderStyle="double" borderColor={palette.modal} borderBackgroundColor="black" backgroundColor="black" paddingX={1} overflowY="hidden">
      <Text bold color={palette.modal}>DETAIL · {model.title}</Text>
      <Box marginTop={1} flexShrink={0} gap={2}>
        {tabs.map((tab, tabIndexValue) => <Text key={tab.key} bold={tabIndexValue === index} color={tabIndexValue === index ? palette.accent : palette.muted}>{tabIndexValue === index ? `[${tab.label}]` : tab.label}</Text>)}
      </Box>
      <Box marginTop={1} flexGrow={1} minHeight={0} overflowY="hidden">
        <WorkstationScrollViewport offset={scrollOffset} onOffsetChange={onScrollOffsetChange} onMaxOffsetChange={onMaxScrollOffsetChange}>
          <DetailedInfoBody model={model} tab={active.key} />
        </WorkstationScrollViewport>
      </Box>
      <Box marginTop={1} flexShrink={0}><ModalFooter detail /></Box>
    </Box>
  </Box>;
}

export function WorkstationHelpModal({ terminalWidth, terminalHeight }: { terminalWidth: number; terminalHeight: number }) {
  const palette = useWorkstationPalette();
  const width = workstationModalWidth(terminalWidth);
  const height = workstationHelpModalHeight(terminalHeight);
  const geometry = workstationFloatingModalGeometry(terminalWidth, terminalHeight, width, height, 1, "center");
  return <Box position="absolute" top={geometry.top} left={0} width={terminalWidth} height={geometry.outerHeight} paddingY={geometry.clearance} alignItems="center" justifyContent="center" backgroundColor="black">
    <Box width={width} height={height} flexDirection="column" borderStyle="double" borderColor={palette.modal} borderBackgroundColor="black" backgroundColor="black" paddingX={1} overflowY="hidden">
      <Text bold color={palette.modal}>HELP · Keyboard reference</Text>
      <Box marginTop={1} flexDirection="column">
        <Text bold color={palette.accent}>Inspector</Text>
        <Text><Text color={palette.accent}>↑↓</Text> select action</Text>
        <Text><Text color={palette.accent}>Enter</Text> run selected action</Text>
        <Text><Text color={palette.accent}>Shortcut</Text> run matching action</Text>
        <Text><Text color={palette.accent}>i</Text> detailed info</Text>
        <Text><Text color={palette.accent}>← / Esc</Text> inventory</Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text bold color={palette.accent}>Global</Text>
        <Text>1-6 switch domain · Tab pane · r refresh · q quit</Text>
        <Text><Text color={palette.accent}>?</Text> help · <Text color={palette.accent}>,</Text> settings</Text>
      </Box>
      <Box marginTop={1} flexShrink={0}><Text dimColor><Text color={palette.accent}>? / Esc</Text> close</Text></Box>
    </Box>
  </Box>;
}

export const workstationDetailUiInternals = { detailedInfoTabs, modalChromeColor: workstationModalChromeColor };
