import { Box, Text, render, useApp, useInput } from "ink";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RuntimeRole } from "@queqiao/platform-paths";
import type { WorkstationSnapshot } from "./workstation.js";
import {
  createWorkstationInspectorViewModel,
  inspectorTargetKey,
  inspectorTargetNeedsDetail,
  type WorkstationInspectorDetail,
  type WorkstationInspectorTarget,
  type WorkstationInspectorViewModel,
  type WorkstationListSection,
  type WorkstationRuntimeSection,
} from "./workstation-inspector.js";
import {
  WorkstationPromptCancelledError,
  WorkstationPromptPanel,
  useWorkstationPromptBridge,
  type WorkstationPromptDriver,
} from "./workstation-prompt-ui.js";
import { WorkstationScrollViewport } from "./workstation-scroll.js";
import type { WorkstationDiagnosticEntry, WorkstationDiagnosticsViewModel } from "./workstation-diagnostics.js";
import { actionOutcome, normalizeWorkstationActionOutcome, type WorkstationActionOutcome, type WorkstationActionResult } from "./workstation-action-outcome.js";
import { WorkstationActionModal } from "./workstation-action-ui.js";
import { detailedInfoTabs, WorkstationDetailedInfoModal, WorkstationHelpModal } from "./workstation-detail-ui.js";
import { workstationColorPickerColumns, WorkstationSettingsModal } from "./workstation-settings-ui.js";
import { workstationModalWidth } from "./workstation-modal-style.js";
import { loadWorkstationSettings, saveWorkstationSettings } from "./workstation-settings.js";
import { DEFAULT_WORKSTATION_PALETTE, resolveWorkstationPalette, workstationColorChoices, workstationSemanticRoles, type WorkstationPalette } from "./workstation-theme.js";
import { WorkstationThemeProvider, useWorkstationPalette } from "./workstation-theme-ui.js";
import {
  createWorkstationUiState,
  moveDomain,
  moveFocusedWindowSpatial,
  moveInventorySelection,
  nextFocusedWindow,
  reconcileInventorySelection,
  resolveWorkstationLayout,
  setDomain,
  setFocusedWindow,
  workstationDomains,
  type WorkstationDomain,
  type WorkstationUiState,
} from "./workstation-ui-state.js";

export type { WorkstationPromptDriver } from "./workstation-prompt-ui.js";
export type WorkstationArea = WorkstationDomain;
export const workstationAreas = workstationDomains.map((entry) => ({ value: entry.id, label: entry.label }));

export type WorkstationDirectAction =
  | { type: "role-status"; role: RuntimeRole; name: string }
  | { type: "role-start"; role: RuntimeRole; name: string }
  | { type: "role-stop"; role: RuntimeRole; name: string }
  | { type: "gateway-copy-mcp-url"; name: string }
  | { type: "gateway-copy-approval-secret"; name: string }
  | { type: "extension-toggle"; extensionId: string; workerName: string; attached: boolean }
  | { type: "diagnostics" };

export type WorkstationFlowAction =
  | { type: "setup-role"; role: RuntimeRole; name?: string }
  | { type: "remove-role"; role: RuntimeRole; name: string }
  | { type: "gateway-members"; name: string }
  | { type: "gateway-join-token"; name: string }
  | { type: "worker-join"; workerName: string }
  | { type: "workspace-add"; workerName: string }
  | { type: "workspace-edit"; workerName: string; workspaceId: string }
  | { type: "workspace-remove"; workerName: string; workspaceId: string; displayName: string }
  | { type: "profile-create" }
  | { type: "profile-edit"; name: string }
  | { type: "profile-rename"; name: string }
  | { type: "profile-delete"; name: string }
  | { type: "extension-install" }
  | { type: "extension-uninstall"; extensionId: string; displayName: string; attachedWorkers: number };

export type WorkstationShellResult = { type: "exit" };
export type WorkstationDirectResult = WorkstationActionResult;
export const workstationRenderOptions = { alternateScreen: true, incrementalRendering: true, maxFps: 20 } as const;

type EntityRef = WorkstationInspectorTarget;

type InventoryItem = { key: string; label: string; meta: string; entity: EntityRef };
type ActionItem = {
  key: string;
  label: string;
  shortcut?: string;
  direct?: WorkstationDirectAction;
  flow?: WorkstationFlowAction;
  disabledReason?: string;
  effect?: string;
};
type Feedback = { kind: "success" | "noop" | "warning" | "error" | "cancelled"; text: string };
type ActionTransaction = {
  action: ActionItem;
  targetTitle: string;
  phase: "running" | "result";
  outcome?: WorkstationActionOutcome;
};
type TerminalSize = { width: number; height: number };
type WorkstationColor = string;

const workstationPalette = resolveWorkstationPalette();

const workstationGeometry = {
  controlWidth: 22,
  inventoryWideWidth: 36,
  inventoryStandardWidth: 34,
  inventoryMetaWidth: 12,
  inventoryHeaderMetaWidth: 18,
  inspectorFieldLabelWidth: 14,
} as const;

function runtimeColor(running: boolean, palette: WorkstationPalette = workstationPalette): WorkstationColor {
  return running ? palette.success : palette.muted;
}

function feedbackColor(kind: Feedback["kind"], palette: WorkstationPalette = workstationPalette): WorkstationColor {
  if (kind === "success") return palette.success;
  if (kind === "warning") return palette.warning;
  if (kind === "error") return palette.danger;
  return palette.muted;
}

function actionColor(action: Pick<ActionItem, "key" | "label">, palette: WorkstationPalette = workstationPalette): WorkstationColor | undefined {
  if (/remove|delete|uninstall/i.test(action.key) || /remove|delete|uninstall/i.test(action.label)) return palette.danger;
  if (action.key === "lifecycle" && /^stop$/i.test(action.label)) return palette.warning;
  return undefined;
}

function snapshotsEqual(left: WorkstationSnapshot, right: WorkstationSnapshot): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function optionalColor(color: WorkstationColor | undefined): { color?: WorkstationColor } {
  return color ? { color } : {};
}

function AutoSelectionScrollViewport({ children, selectedRow, selectedHeight = 1, resetKey }: { children: React.ReactNode; selectedRow: number; selectedHeight?: number; resetKey: string }) {
  const [offset, setOffset] = useState(0);
  useEffect(() => { setOffset(0); }, [resetKey]);
  return <WorkstationScrollViewport offset={offset} target={{ start: selectedRow, height: selectedHeight }} onOffsetChange={setOffset}>{children}</WorkstationScrollViewport>;
}

function useTerminalSize(widthOverride?: number, heightOverride?: number): TerminalSize {
  const [size, setSize] = useState<TerminalSize>(() => ({
    width: widthOverride ?? process.stdout.columns ?? 100,
    height: heightOverride ?? process.stdout.rows ?? 30,
  }));
  useEffect(() => {
    if (widthOverride !== undefined || heightOverride !== undefined) {
      setSize({ width: widthOverride ?? process.stdout.columns ?? 100, height: heightOverride ?? process.stdout.rows ?? 30 });
      return;
    }
    const update = () => setSize({ width: process.stdout.columns ?? 100, height: process.stdout.rows ?? 30 });
    process.stdout.on("resize", update);
    return () => { process.stdout.off("resize", update); };
  }, [widthOverride, heightOverride]);
  return size;
}

function runtimeGlyph(running: boolean): string { return running ? "\u25CF" : "\u25CB"; }
function diagnosticsIndicator(diagnostics: WorkstationDiagnosticsViewModel | undefined): string {
  if (!diagnostics) return "·";
  return diagnostics.ok ? "\u2713" : `!${diagnostics.warnings.length}`;
}

function diagnosticsInventoryMeta(diagnostics: WorkstationDiagnosticsViewModel | undefined): string {
  if (!diagnostics) return "not checked";
  return diagnostics.ok ? "healthy" : `${diagnostics.warnings.length} issue${diagnostics.warnings.length === 1 ? "" : "s"}`;
}

function domainCount(snapshot: WorkstationSnapshot, domain: WorkstationDomain, diagnostics?: WorkstationDiagnosticsViewModel): string {
  if (domain === "gateways") return String(snapshot.gatewayCount);
  if (domain === "workers") return String(snapshot.workerCount);
  if (domain === "workspaces") return String(snapshot.workspaceCount);
  if (domain === "profiles") return String(snapshot.profileCount);
  if (domain === "extensions") return String(snapshot.extensionCount);
  return diagnosticsIndicator(diagnostics);
}

function inventoryItems(snapshot: WorkstationSnapshot, domain: WorkstationDomain, diagnostics?: WorkstationDiagnosticsViewModel): InventoryItem[] {
  if (domain === "gateways") return snapshot.gateways.map((entry) => ({ key: `gateway:${entry.name}`, label: `${runtimeGlyph(entry.running)} ${entry.name}`, meta: entry.servicePort ? `:${entry.servicePort}` : "", entity: { kind: "gateway", name: entry.name } }));
  if (domain === "workers") return snapshot.workers.map((entry) => ({ key: `worker:${entry.name}`, label: `${runtimeGlyph(entry.running)} ${entry.name}`, meta: `${entry.workspaceCount || 0} workspace${entry.workspaceCount === 1 ? "" : "s"}`, entity: { kind: "worker", name: entry.name } }));
  if (domain === "workspaces") return snapshot.workspaces.map((entry) => ({ key: `workspace:${entry.workerName}:${entry.id}`, label: entry.displayName, meta: entry.workerName, entity: { kind: "workspace", workerName: entry.workerName, workspaceId: entry.id } }));
  if (domain === "profiles") return snapshot.profiles.map((entry) => ({ key: `profile:${entry.name}`, label: `${entry.builtin ? "\u25C6" : "\u25C7"} ${entry.name}`, meta: `${entry.tools.length} tool${entry.tools.length === 1 ? "" : "s"}`, entity: { kind: "profile", name: entry.name } }));
  if (domain === "extensions") return snapshot.extensions.map((entry) => {
    const attached = entry.workers.filter((worker) => worker.attached).length;
    return { key: `extension:${entry.id}`, label: `${entry.displayName} ${entry.version}`, meta: `${attached}/${snapshot.workerCount} attached`, entity: { kind: "extension", extensionId: entry.id } };
  });
  return [{ key: "diagnostics", label: "System health", meta: diagnosticsInventoryMeta(diagnostics), entity: { kind: "diagnostics" } }];
}

function actionItems(snapshot: WorkstationSnapshot, entity: EntityRef | undefined): ActionItem[] {
  if (!entity) return [];
  if (entity.kind === "gateway" || entity.kind === "worker") {
    const role: RuntimeRole = entity.kind;
    const instance = (role === "gateway" ? snapshot.gateways : snapshot.workers).find((entry) => entry.name === entity.name);
    if (!instance) return [];
    const lifecycle: ActionItem = instance.running
      ? { key: "lifecycle", label: "Stop", shortcut: "s", effect: `Stop the managed ${role} runtime.`, direct: { type: "role-stop", role, name: entity.name } }
      : { key: "lifecycle", label: "Start", shortcut: "s", effect: `Start the configured ${role} runtime.`, direct: { type: "role-start", role, name: entity.name } };
    return [
      lifecycle,
      { key: "configure", label: "Configure", shortcut: "e", effect: `Edit ${role} configuration.`, flow: { type: "setup-role", role, name: entity.name } },
      ...(role === "gateway" ? [
        { key: "copy-mcp-url", label: "Copy MCP URL", shortcut: "c", effect: "Copy the public MCP endpoint to the clipboard.", direct: { type: "gateway-copy-mcp-url", name: entity.name } as WorkstationDirectAction },
        { key: "copy-approval-secret", label: "Copy approval secret", shortcut: "p", effect: "Copy the local OAuth approval secret without displaying it.", direct: { type: "gateway-copy-approval-secret", name: entity.name } as WorkstationDirectAction },
        { key: "members", label: "Manage Workers", shortcut: "m", effect: "Inspect or change enrolled Worker membership.", ...(!instance.running ? { disabledReason: "Start the Gateway first." } : {}), flow: { type: "gateway-members", name: entity.name } as WorkstationFlowAction },
        { key: "join-code", label: "Create join code", shortcut: "j", effect: "Issue a temporary Worker enrollment code and copy it to the clipboard.", ...(!instance.running ? { disabledReason: "Start the Gateway first." } : {}), flow: { type: "gateway-join-token", name: entity.name } as WorkstationFlowAction },
      ] : [
        { key: "workspace", label: "Add Workspace", shortcut: "w", effect: "Authorize another Workspace on this Worker.", flow: { type: "workspace-add", workerName: entity.name } as WorkstationFlowAction },
        { key: "join", label: "Join Gateway", shortcut: "g", effect: "Enroll this Worker into a Gateway.", ...(!instance.running ? { disabledReason: "Start the Worker first." } : {}), flow: { type: "worker-join", workerName: entity.name } as WorkstationFlowAction },
      ]),
      {
        key: "remove",
        label: `Remove ${role === "gateway" ? "Gateway" : "Worker"}`,
        shortcut: "d",
        effect: "Remove Queqiao-owned local configuration, state, data, and runtime files.",
        ...(instance.running || instance.managed ? { disabledReason: `Stop the ${role === "gateway" ? "Gateway" : "Worker"} first.` } : {}),
        flow: { type: "remove-role", role, name: entity.name },
      },
    ];
  }
  if (entity.kind === "workspace") {
    const workspace = snapshot.workspaces.find((entry) => entry.workerName === entity.workerName && entry.id === entity.workspaceId);
    if (!workspace) return [];
    const worker = snapshot.workers.find((entry) => entry.name === entity.workerName);
    return [
      { key: "edit", label: "Edit Workspace", shortcut: "e", effect: "Edit Workspace identity or copied access policy.", flow: { type: "workspace-edit", workerName: entity.workerName, workspaceId: entity.workspaceId } },
      { key: "remove", label: "Remove Workspace", shortcut: "d", effect: "Remove this authorized root from the Worker.", ...(worker && (worker.workspaceCount || 0) <= 1 ? { disabledReason: "A Worker must retain at least one Workspace." } : {}), flow: { type: "workspace-remove", workerName: entity.workerName, workspaceId: entity.workspaceId, displayName: workspace.displayName } },
    ];
  }
  if (entity.kind === "profile") {
    const profile = snapshot.profiles.find((entry) => entry.name === entity.name);
    if (!profile || profile.builtin) return [];
    return [
      { key: "edit", label: "Edit Profile", shortcut: "e", effect: "Edit this reusable access template. Existing Workspaces stay unchanged.", flow: { type: "profile-edit", name: profile.name } },
      { key: "rename", label: "Rename Profile", shortcut: "m", effect: "Rename this reusable template. Existing Workspaces stay unchanged.", flow: { type: "profile-rename", name: profile.name } },
      { key: "delete", label: "Delete Profile", shortcut: "d", effect: "Delete this reusable template. Existing Workspaces stay unchanged.", flow: { type: "profile-delete", name: profile.name } },
    ];
  }
  if (entity.kind === "extension") {
    const extension = snapshot.extensions.find((entry) => entry.id === entity.extensionId);
    if (!extension) return [];
    const attachedWorkers = extension.workers.filter((entry) => entry.attached).length;
    return [
      ...snapshot.workers.map((worker) => {
        const attached = extension.workers.some((entry) => entry.name === worker.name && entry.attached);
        return { key: `attachment:${worker.name}`, label: `${attached ? "Detach" : "Attach"} · ${worker.name}`, effect: `${attached ? "Detach" : "Attach"} this Extension ${attached ? "from" : "to"} ${worker.name}.`, direct: { type: "extension-toggle", extensionId: extension.id, workerName: worker.name, attached } as WorkstationDirectAction };
      }),
      { key: "uninstall", label: "Uninstall Extension", shortcut: "d", effect: "Remove the Extension from the local Hub and detach owned Worker attachments when required.", flow: { type: "extension-uninstall", extensionId: extension.id, displayName: extension.displayName, attachedWorkers } },
    ];
  }
  return [{ key: "diagnostics", label: "Run diagnostics", effect: "Run the authoritative Queqiao health checks and refresh System health.", direct: { type: "diagnostics" } }];
}

function emptyState(domain: WorkstationDomain, snapshot: WorkstationSnapshot): string[] {
  if (domain === "gateways") return ["No Gateways configured", "Press n to set up a Gateway."];
  if (domain === "workers") return ["No Workers configured", "Press n to set up a Worker."];
  if (domain === "workspaces") return snapshot.workerCount ? ["No Workspaces configured", "Select a Worker and add its first Workspace."] : ["No Workspaces available", "Set up a Worker first."];
  if (domain === "profiles") return ["No Access Profiles available", "Press n to create a custom profile."];
  if (domain === "extensions") return ["No Extensions installed", "Press n to install from npm or a local path."];
  return ["Diagnostics are ready", "Press Enter to run system health checks."];
}

function createAction(snapshot: WorkstationSnapshot, domain: WorkstationDomain, entity: EntityRef | undefined): WorkstationFlowAction | undefined {
  if (domain === "gateways") return { type: "setup-role", role: "gateway" };
  if (domain === "workers") return { type: "setup-role", role: "worker" };
  if (domain === "profiles") return { type: "profile-create" };
  if (domain === "extensions") return { type: "extension-install" };
  if (domain === "workspaces") {
    if (entity?.kind === "workspace") return { type: "workspace-add", workerName: entity.workerName };
    if (snapshot.workers.length === 1) return { type: "workspace-add", workerName: snapshot.workers[0]!.name };
  }
  return undefined;
}

function createActionLabel(domain: WorkstationDomain): string {
  if (domain === "gateways") return "Set up Gateway";
  if (domain === "workers") return "Set up Worker";
  if (domain === "workspaces") return "Add Workspace";
  if (domain === "profiles") return "Create Profile";
  if (domain === "extensions") return "Install Extension";
  return "New";
}

function createActionEffect(domain: WorkstationDomain): string {
  if (domain === "gateways") return "Create or configure a Gateway instance.";
  if (domain === "workers") return "Create or configure a Worker instance.";
  if (domain === "workspaces") return "Authorize another Workspace on the selected Worker.";
  if (domain === "profiles") return "Create a reusable Access Profile template.";
  if (domain === "extensions") return "Install an Extension into the local Hub.";
  return "Create a new resource.";
}

function contextActionItems(snapshot: WorkstationSnapshot, domain: WorkstationDomain, entity: EntityRef | undefined): ActionItem[] {
  const items = actionItems(snapshot, entity);
  const create = createAction(snapshot, domain, entity);
  return create ? [...items, { key: "create", label: createActionLabel(domain), shortcut: "n", effect: createActionEffect(domain), flow: create }] : items;
}

function actionFooterFor(snapshot: WorkstationSnapshot, state: WorkstationUiState, entity: EntityRef | undefined, width: number): string {
  const actions = contextActionItems(snapshot, state.domain, entity);
  const footerActions = entity?.kind === "gateway"
    ? ["lifecycle", "join-code", "copy-mcp-url", "configure", "members", "copy-approval-secret", "remove", "create"]
        .flatMap((key) => actions.filter((action) => action.key === key))
    : actions;
  const suffix = state.focusedWindow === "inspector"
    ? "[i] Details · [?] Help · [,] Settings"
    : "[?] Help · [,] Settings";
  const prefix = "Actions: ";
  const candidates = footerActions.filter((action) => action.shortcut).map((action) => `[${action.shortcut}] ${action.label}`);
  const selected: string[] = [];
  for (const candidate of candidates) {
    const next = `${prefix}${[...selected, candidate, suffix].join(" · ")}`;
    if (next.length > width) break;
    selected.push(candidate);
  }
  if (!selected.length && !actions.length) return `${prefix}none · ${suffix}`;
  return `${prefix}${[...selected, suffix].join(" · ")}`;
}

function fitNavigationFooter(candidates: string[], width: number): string {
  const suffix = "q quit";
  const selected: string[] = [];
  for (const candidate of candidates) {
    const next = [...selected, candidate, suffix].join(" · ");
    if (next.length > width) break;
    selected.push(candidate);
  }
  return [...selected, suffix].join(" · ");
}

function navigationFooterFor(state: WorkstationUiState, width: number): string {
  if (state.focusedWindow === "inspector") return fitNavigationFooter(["[i] details", "\u2191\u2193 action", "Enter run", "1-6 domain", "\u2190/Esc inventory", "shortcuts run", "? help", ", settings", "Tab pane", "r refresh"], width);
  return fitNavigationFooter(["←→ pane", "↑↓/jk item", "Enter inspect", "1-6 domain", "? help", ", settings", "Tab pane", "r refresh"], width);
  if (state.focusedWindow === "control") return fitNavigationFooter(["\u2192/Enter inventory", "\u2191\u2193/jk domain", "1-6 domain", "? help", ", settings", "Tab pane", "r refresh"], width);
  return fitNavigationFooter(["←→ pane", "↑↓/jk item", "Enter inspect", "1-6 domain", "? help", ", settings", "Tab pane", "r refresh"], width);
}

function entityTitle(snapshot: WorkstationSnapshot, entity: EntityRef | undefined): string {
  if (!entity) return "Nothing selected";
  if (entity.kind === "gateway" || entity.kind === "worker") return entity.name;
  if (entity.kind === "workspace") return snapshot.workspaces.find((entry) => entry.workerName === entity.workerName && entry.id === entity.workspaceId)?.displayName || entity.workspaceId;
  if (entity.kind === "profile") return entity.name;
  if (entity.kind === "extension") return snapshot.extensions.find((entry) => entry.id === entity.extensionId)?.displayName || entity.extensionId;
  return "System health";
}

function entityExists(snapshot: WorkstationSnapshot, entity: EntityRef): boolean {
  if (entity.kind === "gateway") return snapshot.gateways.some((entry) => entry.name === entity.name);
  if (entity.kind === "worker") return snapshot.workers.some((entry) => entry.name === entity.name);
  if (entity.kind === "workspace") return snapshot.workspaces.some((entry) => entry.workerName === entity.workerName && entry.id === entity.workspaceId);
  if (entity.kind === "profile") return snapshot.profiles.some((entry) => entry.name === entity.name);
  if (entity.kind === "extension") return snapshot.extensions.some((entry) => entry.id === entity.extensionId);
  return true;
}

function ControlView({ snapshot, state, diagnostics }: { snapshot: WorkstationSnapshot; state: WorkstationUiState; diagnostics: WorkstationDiagnosticsViewModel | undefined }) {
  const palette = useWorkstationPalette();
  let lastGroup = "";
  const focused = state.focusedWindow === "control";
  return <Box flexDirection="column" borderStyle="single" borderColor={focused ? palette.accent : undefined} width={workstationGeometry.controlWidth} flexShrink={0} marginRight={1}>
    <Text bold {...optionalColor(focused ? palette.accent : undefined)}>{focused ? "\u25B8 CONTROL" : "  CONTROL"}</Text>
    <Box flexDirection="column" marginTop={1}>{workstationDomains.flatMap((entry) => {
      const heading = entry.group !== lastGroup ? entry.group : undefined;
      lastGroup = entry.group;
      const selected = entry.id === state.domain;
      return [...(heading ? [<Text key={`${entry.id}:group`} dimColor color={palette.muted}>{heading}</Text>] : []), <Text key={entry.id} bold={selected} {...optionalColor(selected ? palette.accent : undefined)}>{selected ? "\u258C" : " "} {entry.label.padEnd(15)} {domainCount(snapshot, entry.id, diagnostics)}</Text>];
    })}</Box>
  </Box>;
}

function DomainStrip({ domain }: { domain: WorkstationDomain }) {
  return <Text dimColor>{workstationDomains.map((entry, index) => `${index + 1} ${entry.shortLabel}${entry.id === domain ? "*" : ""}`).join("  ")}</Text>;
}

function InventoryView({ snapshot, state, diagnostics, width, compactDomains = false }: { snapshot: WorkstationSnapshot; state: WorkstationUiState; diagnostics: WorkstationDiagnosticsViewModel | undefined; width?: number; compactDomains?: boolean }) {
  const palette = useWorkstationPalette();
  const items = inventoryItems(snapshot, state.domain, diagnostics);
  const selected = state.selection[state.domain];
  const descriptor = workstationDomains.find((entry) => entry.id === state.domain)!;
  const focused = state.focusedWindow === "inventory";
  return <Box flexDirection="column" borderStyle="single" borderColor={focused ? palette.accent : undefined} width={width} flexGrow={width ? 0 : 1} flexShrink={width ? 0 : 1} paddingX={1} marginRight={state.layout === "narrow" ? 0 : 1}>
    <Box>
      <Box flexGrow={1} minWidth={0}><Text bold wrap="truncate-end" {...optionalColor(focused ? palette.accent : undefined)}>{focused ? "\u25B8 INVENTORY" : "  INVENTORY"}</Text></Box>
      <Box width={workstationGeometry.inventoryHeaderMetaWidth} flexShrink={0} justifyContent="flex-end"><Text wrap="truncate-start" color={palette.accent}>{descriptor.label} {domainCount(snapshot, state.domain, diagnostics)}</Text></Box>
    </Box>
    {compactDomains ? <Box marginTop={1}><DomainStrip domain={state.domain} /></Box> : null}
    <Box flexDirection="column" marginTop={1} flexGrow={1} minHeight={0}>
      <AutoSelectionScrollViewport selectedRow={items.length ? selected : 0} resetKey={state.domain}>
        {items.length ? items.map((item, index) => <Box key={item.key}>
          <Box flexGrow={1} minWidth={0}><Text wrap="truncate-end" bold={index === selected} {...optionalColor(index === selected ? palette.accent : undefined)}>{index === selected ? "\u258C " : "  "}{item.label}</Text></Box>
          <Box width={workstationGeometry.inventoryMetaWidth} flexShrink={0} justifyContent="flex-end"><Text wrap="truncate-start" dimColor color={palette.muted}>{item.meta}</Text></Box>
        </Box>) : emptyState(state.domain, snapshot).map((line, index) => <Text key={line} dimColor={index > 0} {...optionalColor(index > 0 ? palette.muted : undefined)}>{line}</Text>)}
      </AutoSelectionScrollViewport>
    </Box>
  </Box>;
}

type InspectorDetailLoadState = {
  key: string;
  status: "loading" | "ready" | "error";
  detail?: WorkstationInspectorDetail;
  message?: string;
};

function InspectorField({ label, children, indent = 0, wrap = "truncate-end" }: { label: string; children: React.ReactNode; indent?: number; wrap?: "truncate-end" | "truncate-middle" | "truncate-start" }) {
  return <Box>
    <Box width={workstationGeometry.inspectorFieldLabelWidth} flexShrink={0}><Text>{" ".repeat(indent)}{label}</Text></Box>
    <Box flexGrow={1} flexShrink={1} minWidth={0}><Text wrap={wrap}>{children}</Text></Box>
  </Box>;
}

function InspectorListLine({ children, indent = 4, wrap = "truncate-middle" }: { children: React.ReactNode; indent?: number; wrap?: "truncate-end" | "truncate-middle" | "truncate-start" }) {
  return <Text dimColor wrap={wrap}>{" ".repeat(indent)}{children}</Text>;
}

function RuntimeProbe({ runtime, compact = false }: { runtime: WorkstationRuntimeSection; compact?: boolean }) {
  const palette = useWorkstationPalette();
  if (runtime.state === "ready") {
    if (!runtime.active) {
      return <InspectorField label="Probe" indent={2}><Text bold color={palette.muted}>{"\u25CB stopped"}</Text></InspectorField>;
    }
    const probe = runtime.health.healthy ? "\u2713 healthy" : runtime.health.reachable ? "! degraded" : "! unreachable";
    const probeColor = runtime.health.healthy ? palette.success : runtime.health.reachable ? palette.warning : palette.danger;
    return <Box flexDirection="column">
      <InspectorField label="Probe" indent={2}><Text bold color={probeColor}>{probe}</Text>{runtime.health.status ? ` · HTTP ${runtime.health.status}` : ""}</InspectorField>
      {!compact && runtime.pid ? <InspectorField label="Managed PID" indent={2}>{runtime.pid}</InspectorField> : null}
      {!compact && runtime.health.error ? <Text dimColor color={palette.muted} wrap="truncate-end">  {runtime.health.error}</Text> : null}
    </Box>;
  }
  return <Text dimColor color={runtime.state === "error" ? palette.danger : palette.muted}>  {runtime.state === "error" ? "!" : "\u2026"} {runtime.message}</Text>;
}

function RelationshipSection<T>({ label, section, renderItem }: { label: string; section: WorkstationListSection<T>; renderItem: (item: T, index: number) => React.ReactNode }) {
  const palette = useWorkstationPalette();
  if (section.state === "ready") return <Box flexDirection="column"><InspectorField label={label} indent={2}>{section.items.length}</InspectorField>{section.items.map(renderItem)}</Box>;
  return <InspectorField label={label} indent={2}><Text dimColor color={section.state === "error" ? palette.warning : palette.muted}>{section.state === "error" ? "!" : "\u2026"} {section.message}</Text></InspectorField>;
}

function diagnosticEntryColor(entry: WorkstationDiagnosticEntry, palette: WorkstationPalette = workstationPalette): WorkstationColor {
  if (entry.state === "healthy") return "\u2713";
  if (entry.state === "warning") return palette.warning;
  if (entry.state === "error") return palette.danger;
  return palette.muted;
}

function diagnosticEntryGlyph(entry: WorkstationDiagnosticEntry): string {
  if (entry.state === "healthy") return "\u2713";
  if (entry.state === "stopped") return "\u25CB";
  return "!";
}

function DiagnosticEntryLine({ entry }: { entry: WorkstationDiagnosticEntry }) {
  const palette = useWorkstationPalette();
  return <Box flexDirection="column">
    <Text wrap="truncate-end"><Text bold color={diagnosticEntryColor(entry, palette)}>{diagnosticEntryGlyph(entry)}</Text> {entry.label} · {entry.summary}</Text>
    {entry.detail ? <InspectorListLine indent={2}>{entry.detail}</InspectorListLine> : null}
  </Box>;
}

function DiagnosticsSummary({ diagnostics }: { diagnostics: WorkstationDiagnosticsViewModel }) {
  const palette = useWorkstationPalette();
  const extensionColor = diagnostics.extensions.state === "healthy" ? palette.success : palette.warning;
  return <Box flexDirection="column">
    <Text bold color={diagnostics.ok ? palette.success : palette.warning}>{diagnostics.ok ? "\u2713 HEALTHY" : `! ${diagnostics.warnings.length} ISSUE${diagnostics.warnings.length === 1 ? "" : "S"}`}</Text>
    <InspectorField label="Core checks">{diagnostics.core.length}</InspectorField>
    <InspectorField label="Routes">{diagnostics.routing.length}</InspectorField>
    <InspectorField label="Extension Hub"><Text color={extensionColor}>{diagnostics.extensions.summary}</Text></InspectorField>
    <InspectorField label="Warnings">{diagnostics.warnings.length}</InspectorField>
  </Box>;
}

function InspectorSummary({ model, detailState }: { model: WorkstationInspectorViewModel | undefined; detailState: InspectorDetailLoadState | undefined }) {
  const palette = useWorkstationPalette();
  if (!model) return <Text dimColor>Select an item to inspect it.</Text>;
  const loadMarker = detailState?.key === model.key && detailState.status !== "ready"
    ? <Text dimColor color={detailState.status === "error" ? palette.warning : palette.muted}>{detailState.status === "loading" ? (detailState.detail ? "\u2026 Refreshing detail · previous detail shown" : "\u2026 Loading runtime detail") : `! Detail unavailable${detailState.message ? ` · ${detailState.message}` : ""}`}</Text>
    : null;

  if (model.kind === "gateway") return <Box flexDirection="column">
    <Text><Text bold color={runtimeColor(model.running, palette)}>{runtimeGlyph(model.running)} {model.running ? "RUNNING" : "STOPPED"}</Text> · {model.managed ? "managed" : "unmanaged"}</Text>
    {model.publicUrl ? <InspectorField label="Public URL" wrap="truncate-middle">{model.publicUrl}</InspectorField> : null}
    <InspectorField label="Service">{model.servicePort ? `:${model.servicePort}` : "\u2014"}</InspectorField>
    <InspectorField label="Management">{model.managementPort ? `:${model.managementPort}` : "\u2014"}</InspectorField>
    <RuntimeProbe runtime={model.runtime} compact />
    <RelationshipSection label="Workers" section={model.workers} renderItem={() => null} />
    {loadMarker}
  </Box>;

  if (model.kind === "worker") return <Box flexDirection="column">
    <Text><Text bold color={runtimeColor(model.running, palette)}>{runtimeGlyph(model.running)} {model.running ? "RUNNING" : "STOPPED"}</Text> · {model.managed ? "managed" : "unmanaged"}</Text>
    {model.endpoint ? <InspectorField label="Endpoint" wrap="truncate-middle">{model.endpoint}</InspectorField> : null}
    <RuntimeProbe runtime={model.runtime} compact />
    <InspectorField label="Workspaces">{model.workspaces.length}</InspectorField>
    <InspectorField label="Extensions">{model.extensions.length}</InspectorField>
    <RelationshipSection label="Gateways" section={model.gateways} renderItem={() => null} />
    {loadMarker}
  </Box>;

  if (model.kind === "workspace") return <Box flexDirection="column">
    <InspectorField label="Worker">{model.workerName}</InspectorField>
    <InspectorField label="Root" wrap="truncate-middle">{model.root}</InspectorField>
    <InspectorField label="Profile">{model.profile}</InspectorField>
    <Box marginTop={1}><Text dimColor wrap="truncate-end">Access Profile copied on apply · no live link.</Text></Box>
  </Box>;

  if (model.kind === "profile") return <Box flexDirection="column">
    <Text>{model.builtin ? "\u25C6 Built-in · immutable" : "\u25C7 Custom profile"}</Text>
    <InspectorField label="Tools">{model.tools.length}</InspectorField>
    <InspectorField label="Executables">{model.allowedExecutables.length}</InspectorField>
    <Box marginTop={1}><Text dimColor wrap="truncate-end">Detached template · existing Workspaces stay unchanged.</Text></Box>
  </Box>;

  if (model.kind === "extension") {
    const attached = model.attachments.filter((worker) => worker.attached).length;
    return <Box flexDirection="column">
      <Text wrap="truncate-end">{model.extensionId}</Text>
      <InspectorField label="Version">{model.version}</InspectorField>
      <InspectorField label="Package" wrap="truncate-middle">{model.package}</InspectorField>
      <InspectorField label="Workers">{attached}/{model.attachments.length} attached</InspectorField>
    </Box>;
  }

  if (!model.diagnostics) return <Box flexDirection="column"><Text>Core runtime, routing, and Extension Hub health</Text>{loadMarker ?? <Text dimColor color={palette.muted}>Diagnostics have not been loaded yet.</Text>}</Box>;
  return <Box flexDirection="column"><DiagnosticsSummary diagnostics={model.diagnostics} />{loadMarker}</Box>;
}

function ActionLine({ action, selected }: { action: ActionItem; selected: boolean }) {
  const palette = useWorkstationPalette();
  const color = action.disabledReason ? palette.muted : selected ? palette.accent : actionColor(action, palette);
  return <Box flexDirection="column">
    <Text wrap="truncate-end" bold={selected && !action.disabledReason} {...optionalColor(color)}>{selected ? "\u203A " : "  "}{action.shortcut ? <Text color={action.disabledReason ? palette.muted : palette.accent}>[{action.shortcut}] </Text> : null}{action.label}</Text>
    {action.disabledReason ? <Text dimColor color={palette.muted}>    unavailable · {action.disabledReason}</Text> : null}
  </Box>;
}

function InspectorView({ snapshot, state, entity, model, detailState, actionIndex, contextActions }: { snapshot: WorkstationSnapshot; state: WorkstationUiState; entity: EntityRef | undefined; model: WorkstationInspectorViewModel | undefined; detailState: InspectorDetailLoadState | undefined; actionIndex: number; contextActions: ActionItem[] }) {
  const palette = useWorkstationPalette();
  const title = model?.title ?? entityTitle(snapshot, entity);
  const focused = state.focusedWindow === "inspector";
  const selectedAction = contextActions.length ? Math.min(actionIndex, contextActions.length - 1) : 0;
  return <Box flexDirection="column" borderStyle="single" borderColor={focused ? palette.accent : undefined} flexGrow={1} flexShrink={1} minWidth={0} minHeight={0} overflowY="hidden" paddingX={1}>
    <Box>
      <Box width={18} flexShrink={0}><Text bold {...optionalColor(focused ? palette.accent : undefined)}>{focused ? "\u25B8" : " "} INSPECTOR</Text></Box>
      <Box flexGrow={1} flexShrink={1} minWidth={0} justifyContent="flex-end"><Text bold wrap="truncate-end" color={palette.accent}>{title}</Text></Box>
    </Box>
    <Box flexDirection="column" marginTop={1} flexShrink={0}><InspectorSummary model={model} detailState={detailState} /></Box>
    <Box flexDirection="column" marginTop={1} flexGrow={1} minHeight={0}>
      <Text bold>Actions</Text>
      <Box flexDirection="column" flexGrow={1} minHeight={0}>
        <AutoSelectionScrollViewport selectedRow={contextActions.length ? selectedAction : 0} resetKey={title}>
          {contextActions.length ? contextActions.map((action, index) => <ActionLine key={action.key} action={action} selected={focused && selectedAction === index} />) : <Text dimColor color={palette.muted}>No available actions.</Text>}
        </AutoSelectionScrollViewport>
      </Box>
    </Box>
    <Box flexShrink={0}><Text dimColor color={palette.muted}>↑↓ select · Enter run · [i] details · [?] help · [,] settings</Text></Box>
  </Box>;
}

function statusText(snapshot: WorkstationSnapshot, busy: boolean, feedback: Feedback | undefined, refreshWarning: string | undefined, diagnosticsHealth: WorkstationDiagnosticsViewModel | undefined, verification: boolean): string {
  if (feedback) return `${feedback.kind === "success" ? "\u2713" : feedback.kind === "noop" || feedback.kind === "cancelled" ? "\u25CB" : "!"} ${feedback.text}`;
  if (busy) return "\u2026 Working";
  if (refreshWarning) return `! ${refreshWarning}`;
  const total = snapshot.gatewayCount + snapshot.workerCount;
  const running = snapshot.runningGatewayCount + snapshot.runningWorkerCount;
  if (diagnosticsHealth) {
    const health = diagnosticsHealth.ok ? "\u2713 Healthy" : `! ${diagnosticsHealth.warnings.length} health issue${diagnosticsHealth.warnings.length === 1 ? "" : "s"}`;
    return `${health} · ${running}/${total} runtimes${verification ? " · isolated verification" : ""}`;
  }
  return `${running === total && total > 0 ? "\u2713" : total ? "!" : "\u25CB"} Ready · ${running}/${total} runtimes${verification ? " · isolated verification" : ""}`;
}

function statusColor(snapshot: WorkstationSnapshot, busy: boolean, feedback: Feedback | undefined, refreshWarning: string | undefined, diagnosticsHealth: WorkstationDiagnosticsViewModel | undefined, palette: WorkstationPalette = workstationPalette): WorkstationColor {
  if (feedback) return feedbackColor(feedback.kind, palette);
  if (busy) return palette.accent;
  if (refreshWarning) return palette.warning;
  if (diagnosticsHealth) return diagnosticsHealth.ok ? palette.success : palette.warning;
  const total = snapshot.gatewayCount + snapshot.workerCount;
  const running = snapshot.runningGatewayCount + snapshot.runningWorkerCount;
  if (!total) return palette.muted;
  return running === total ? palette.success : palette.warning;
}

export type WorkstationAppProps = {
  snapshot: WorkstationSnapshot;
  executeDirect: (action: WorkstationDirectAction) => Promise<WorkstationDirectResult>;
  executeFlow: (action: WorkstationFlowAction, prompts: WorkstationPromptDriver) => Promise<WorkstationDirectResult>;
  onExit: () => void;
  refresh?: () => Promise<WorkstationSnapshot>;
  loadInspectorDetail?: (target: WorkstationInspectorTarget, snapshot: WorkstationSnapshot) => Promise<WorkstationInspectorDetail>;
  refreshIntervalMs?: number;
  terminalWidth?: number;
  terminalHeight?: number;
  verificationEnvironment?: boolean;
  initialAppearance?: WorkstationPalette;
  saveAppearance?: (colors: WorkstationPalette) => Promise<void>;
};

export function WorkstationApp({ snapshot: initialSnapshot, executeDirect, executeFlow, onExit, refresh, loadInspectorDetail, refreshIntervalMs = 2500, terminalWidth, terminalHeight, verificationEnvironment = process.env.QUEQIAO_WORKSTATION_VERIFY === "1", initialAppearance = DEFAULT_WORKSTATION_PALETTE, saveAppearance }: WorkstationAppProps) {
  const { exit } = useApp();
  const terminal = useTerminalSize(terminalWidth, terminalHeight);
  const layout = resolveWorkstationLayout(terminal.width, terminal.height);
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [ui, setUi] = useState<WorkstationUiState>(() => createWorkstationUiState(layout));
  const [palette, setPalette] = useState<WorkstationPalette>(() => resolveWorkstationPalette(initialAppearance));
  const [settingsColors, setSettingsColors] = useState<WorkstationPalette>(() => resolveWorkstationPalette(initialAppearance));
  const [settingsRoleIndex, setSettingsRoleIndex] = useState(0);
  const [settingsPickerOpen, setSettingsPickerOpen] = useState(false);
  const [settingsPickerIndex, setSettingsPickerIndex] = useState(0);
  const [actionIndex, setActionIndex] = useState(0);
  const actionIndexRef = useRef(0);
  const [overlay, setOverlay] = useState<"detail" | "help" | "settings" | undefined>();
  const [detailTabIndex, setDetailTabIndex] = useState(0);
  const [detailScroll, setDetailScroll] = useState(0);
  const [detailMaxScroll, setDetailMaxScroll] = useState(0);
  const [transaction, setTransaction] = useState<ActionTransaction | undefined>();
  const [transactionScroll, setTransactionScroll] = useState(0);
  const [transactionMaxScroll, setTransactionMaxScroll] = useState(0);
  const selectedKeysRef = useRef<Record<WorkstationDomain, string>>({ gateways: "", workers: "", workspaces: "", profiles: "", extensions: "", diagnostics: "diagnostics" });
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | undefined>();
  const [refreshWarning, setRefreshWarning] = useState<string | undefined>();
  const [diagnosticsHealth, setDiagnosticsHealth] = useState<WorkstationDiagnosticsViewModel | undefined>();
  const [detailState, setDetailState] = useState<InspectorDetailLoadState | undefined>();
  const detailRequestRef = useRef(0);
  const refreshInFlightRef = useRef(false);
  const promptBridge = useWorkstationPromptBridge();
  const items = useMemo(() => inventoryItems(snapshot, ui.domain, diagnosticsHealth), [snapshot, ui.domain, diagnosticsHealth]);
  const selectedIndex = Math.min(ui.selection[ui.domain], Math.max(0, items.length - 1));
  const entity = items[selectedIndex]?.entity;
  const entityKey = entity ? inspectorTargetKey(entity) : "";
  const contextActions = useMemo(() => contextActionItems(snapshot, ui.domain, entity), [snapshot, ui.domain, entity]);
  const inspectorDetail = detailState?.key === entityKey ? detailState.detail : undefined;
  const inspectorModel = useMemo(() => entity ? createWorkstationInspectorViewModel(snapshot, entity, inspectorDetail) : undefined, [snapshot, entityKey, inspectorDetail]);

  const requestInspectorDetail = useCallback(async (target: WorkstationInspectorTarget, sourceSnapshot: WorkstationSnapshot, preserveCurrent: boolean) => {
    const requestId = ++detailRequestRef.current;
    const key = inspectorTargetKey(target);
    if (!loadInspectorDetail || !inspectorTargetNeedsDetail(target)) {
      setDetailState(undefined);
      return undefined;
    }
    setDetailState((current) => ({
      key,
      status: "loading",
      ...(preserveCurrent && current?.key === key && current.detail ? { detail: current.detail } : {}),
    }));
    try {
      const detail = await loadInspectorDetail(target, sourceSnapshot);
      if (detailRequestRef.current !== requestId || detail.key !== key) return undefined;
      if (detail.kind === "diagnostics") setDiagnosticsHealth(detail.diagnostics);
      setDetailState({ key, status: "ready", detail });
      return detail;
    } catch (error) {
      if (detailRequestRef.current !== requestId) return undefined;
      setDetailState((current) => ({
        key,
        status: "error",
        ...(current?.key === key && current.detail ? { detail: current.detail } : {}),
        message: error instanceof Error ? error.message : "Inspector detail could not be loaded",
      }));
      return undefined;
    }
  }, [loadInspectorDetail]);

  const setActionFocus = (index: number) => { actionIndexRef.current = index; setActionIndex(index); };
  useEffect(() => {
    setSnapshot((current) => snapshotsEqual(current, initialSnapshot) ? current : initialSnapshot);
  }, [initialSnapshot]);
  useEffect(() => { setUi((current) => setFocusedWindow({ ...current, layout }, current.focusedWindow)); }, [layout]);
  useEffect(() => {
    setUi((current) => {
      const domainItems = inventoryItems(snapshot, current.domain);
      const wantedKey = selectedKeysRef.current[current.domain];
      const keyIndex = wantedKey ? domainItems.findIndex((item) => item.key === wantedKey) : -1;
      const reconciled = keyIndex >= 0 ? { ...current, selection: { ...current.selection, [current.domain]: keyIndex } } : reconcileInventorySelection(current, domainItems.length);
      const selected = domainItems[reconciled.selection[current.domain]];
      if (selected) selectedKeysRef.current[current.domain] = selected.key;
      return reconciled;
    });
  }, [snapshot]);
  useEffect(() => {
    setActionFocus(0);
    setOverlay(undefined);
    setDetailTabIndex(0);
    setDetailScroll(0);
    setDetailMaxScroll(0);
    if (!entity) {
      detailRequestRef.current += 1;
      setDetailState(undefined);
      return;
    }
    void requestInspectorDetail(entity, snapshot, false);
  }, [entityKey, requestInspectorDetail]);

  const refreshNow = useCallback(async (reloadInspector: boolean, foreground = true) => {
    if (!refresh || busy || promptBridge.prompt || refreshInFlightRef.current) return;
    refreshInFlightRef.current = true;
    if (foreground) setBusy(true);
    try {
      const nextSnapshot = await refresh();
      setRefreshWarning(undefined);
      setSnapshot((current) => snapshotsEqual(current, nextSnapshot) ? current : nextSnapshot);
      if (reloadInspector && entity && entityExists(nextSnapshot, entity)) {
        await requestInspectorDetail(entity, nextSnapshot, true);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setRefreshWarning(`Refresh failed · ${message} · last-good data shown`);
    } finally {
      refreshInFlightRef.current = false;
      if (foreground) setBusy(false);
    }
  }, [refresh, busy, promptBridge.prompt, entityKey, requestInspectorDetail]);
  useEffect(() => {
    if (!refresh || refreshIntervalMs <= 0) return;
    const timer = setInterval(() => { void refreshNow(false, false); }, refreshIntervalMs);
    return () => clearInterval(timer);
  }, [refresh, refreshIntervalMs, refreshNow]);

  const refreshAfterAction = useCallback(async () => {
    let nextSnapshot = snapshot;
    if (refresh) {
      try {
        nextSnapshot = await refresh();
        setRefreshWarning(undefined);
        setSnapshot((current) => snapshotsEqual(current, nextSnapshot) ? current : nextSnapshot);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setRefreshWarning(`Refresh failed · ${message} · last-good data shown`);
        return;
      }
    }
    if (entity && entityExists(nextSnapshot, entity)) {
      await requestInspectorDetail(entity, nextSnapshot, true);
    }
  }, [refresh, snapshot, entityKey, requestInspectorDetail]);

  const errorOutcomeFor = (action: ActionItem, error: unknown): WorkstationActionOutcome => {
    const message = error instanceof Error ? error.message : String(error);
    const remediation = action.key === "join-code" || action.key === "members"
      ? ["Start the Gateway and try again."]
      : action.key === "join"
        ? ["Start the Worker and try again."]
        : [];
    return actionOutcome("error", `Cannot ${action.label.toLowerCase()}`, {
      summary: message,
      ...(remediation.length ? { remediation } : {}),
    });
  };
  const showOutcome = (action: ActionItem, targetTitle: string, outcome: WorkstationActionOutcome) => {
    setFeedback(undefined);
    setTransactionScroll(0);
    setTransactionMaxScroll(0);
    setTransaction({ action, targetTitle, phase: "result", outcome });
  };
  const runDirect = useCallback(async (item: ActionItem, targetTitle: string) => {
    if (!item.direct) return;
    setBusy(true);
    setFeedback(undefined);
    setTransaction({ action: item, targetTitle, phase: "running" });
    try {
      const outcome = normalizeWorkstationActionOutcome(await executeDirect(item.direct));
      showOutcome(item, targetTitle, outcome);
      if (outcome.status === "success" || outcome.status === "noop" || outcome.status === "warning") await refreshAfterAction();
    } catch (error) {
      showOutcome(item, targetTitle, errorOutcomeFor(item, error));
    } finally {
      setBusy(false);
    }
  }, [executeDirect, refreshAfterAction]);
  const runFlow = useCallback(async (item: ActionItem, targetTitle: string) => {
    if (!item.flow) return;
    setBusy(true);
    setFeedback(undefined);
    setTransaction({ action: item, targetTitle, phase: "running" });
    try {
      const outcome = normalizeWorkstationActionOutcome(await executeFlow(item.flow, promptBridge.driver));
      showOutcome(item, targetTitle, outcome);
      if (outcome.status === "success" || outcome.status === "noop" || outcome.status === "warning") await refreshAfterAction();
    } catch (error) {
      const outcome = error instanceof WorkstationPromptCancelledError
        ? actionOutcome("cancelled", "Action cancelled", { summary: "No operation was committed." })
        : errorOutcomeFor(item, error);
      showOutcome(item, targetTitle, outcome);
    } finally {
      setBusy(false);
    }
  }, [executeFlow, promptBridge.driver, refreshAfterAction]);
  const runDiagnostics = useCallback(async (item: ActionItem, targetTitle: string) => {
    if (!entity || entity.kind !== "diagnostics") return;
    setBusy(true);
    setFeedback(undefined);
    setTransaction({ action: item, targetTitle, phase: "running" });
    try {
      const detail = await requestInspectorDetail(entity, snapshot, true);
      if (detail?.kind !== "diagnostics") {
        showOutcome(item, targetTitle, actionOutcome("error", "Diagnostics could not be loaded", { remediation: ["Retry diagnostics after checking local runtime access."] }));
        return;
      }
      const count = detail.diagnostics.warnings.length;
      showOutcome(item, targetTitle, actionOutcome(detail.diagnostics.ok ? "success" : "warning", detail.diagnostics.ok ? "Diagnostics complete" : "Diagnostics found issues", {
        summary: detail.diagnostics.ok ? "No health issues were reported." : `${count} health issue${count === 1 ? "" : "s"} found. Review System health for remediation.`,
      }));
    } catch (error) {
      showOutcome(item, targetTitle, errorOutcomeFor(item, error));
    } finally {
      setBusy(false);
    }
  }, [entityKey, requestInspectorDetail, snapshot]);
  const openAction = (action: ActionItem | undefined) => {
    if (!action || busy) return;
    const targetTitle = entity ? entityTitle(snapshot, entity) : workstationDomains.find((entry) => entry.id === ui.domain)!.label;
    setOverlay(undefined);
    setFeedback(undefined);
    setTransactionScroll(0);
    setTransactionMaxScroll(0);
    setUi((current) => setFocusedWindow(current, "inspector"));
    if (action.disabledReason) {
      const outcome = actionOutcome("warning", `${action.label} unavailable`, {
        summary: action.disabledReason,
        remediation: [action.disabledReason],
      });
      showOutcome(action, targetTitle, outcome);
      return;
    }
    if (action.direct?.type === "diagnostics") {
      void runDiagnostics(action, targetTitle);
      return;
    }
    if (action.flow) {
      void runFlow(action, targetTitle);
      return;
    }
    if (action.direct) void runDirect(action, targetTitle);
  };
  const closeTransaction = () => {
    setTransaction(undefined);
    setTransactionScroll(0);
    setTransactionMaxScroll(0);
    setFeedback(undefined);
  };
  const openDetailedInfo = () => {
    if (!inspectorModel || ui.focusedWindow !== "inspector") return;
    setDetailTabIndex(0);
    setDetailScroll(0);
    setDetailMaxScroll(0);
    setOverlay("detail");
  };
  const closeOverlay = () => {
    setOverlay(undefined);
    setDetailScroll(0);
    setDetailMaxScroll(0);
  };
  const openSettings = () => {
    setSettingsColors({ ...palette });
    setSettingsRoleIndex(0);
    setSettingsPickerOpen(false);
    setSettingsPickerIndex(0);
    setOverlay("settings");
  };
  const openSettingsColorPicker = () => {
    const role = workstationSemanticRoles[Math.min(settingsRoleIndex, workstationSemanticRoles.length - 1)]!;
    const currentIndex = Math.max(0, workstationColorChoices.findIndex((choice) => choice.value === settingsColors[role.id]));
    setSettingsPickerIndex(currentIndex);
    setSettingsPickerOpen(true);
  };
  const moveSettingsColorPicker = (rowDelta: number, columnDelta: number) => {
    const columns = workstationColorPickerColumns(workstationModalWidth(terminal.width));
    setSettingsPickerIndex((current) => {
      const row = Math.floor(current / columns);
      const column = current % columns;
      const rows = Math.ceil(workstationColorChoices.length / columns);
      let nextRow = Math.max(0, Math.min(rows - 1, row + rowDelta));
      let nextColumn = Math.max(0, Math.min(columns - 1, column + columnDelta));
      let next = nextRow * columns + nextColumn;
      while (next >= workstationColorChoices.length && nextColumn > 0) {
        nextColumn -= 1;
        next = nextRow * columns + nextColumn;
      }
      return next;
    });
  };
  const chooseSettingsColor = () => {
    const role = workstationSemanticRoles[Math.min(settingsRoleIndex, workstationSemanticRoles.length - 1)]!;
    const choice = workstationColorChoices[Math.min(settingsPickerIndex, workstationColorChoices.length - 1)]!;
    setSettingsColors((current) => ({ ...current, [role.id]: choice.value }));
    setSettingsPickerOpen(false);
  };
  const applyAppearance = async () => {
    const next = resolveWorkstationPalette(settingsColors);
    setBusy(true);
    try {
      await saveAppearance?.(next);
      setPalette(next);
      setFeedback({ kind: "success", text: "Appearance colors saved" });
      setOverlay(undefined);
    } catch (error) {
      setFeedback({ kind: "error", text: `Appearance update failed · ${error instanceof Error ? error.message : String(error)}` });
    } finally {
      setBusy(false);
    }
  };
  const selectDomain = (domain: WorkstationDomain) => { setUi((current) => setDomain(current, domain)); setActionFocus(0); setOverlay(undefined); setTransaction(undefined); setFeedback(undefined); };
  const moveInventory = (delta: number) => {
    setUi((current) => { const domainItems = inventoryItems(snapshot, current.domain); const next = moveInventorySelection(current, delta, domainItems.length); const selected = domainItems[next.selection[current.domain]]; if (selected) selectedKeysRef.current[current.domain] = selected.key; return next; });
    setActionFocus(0);
    setOverlay(undefined);
    setTransaction(undefined);
    setFeedback(undefined);
  };

  useInput((input, key) => {
    if (layout === "too-small") {
      if (promptBridge.prompt) {
        if (key.escape) promptBridge.cancel();
        return;
      }
      if (!busy && input === "q") { onExit(); exit(); }
      return;
    }
    if (promptBridge.handleInput(input, key)) return;
    if (busy) return;
    if (transaction) {
      if (transaction.phase === "result") {
        if (key.upArrow) { setTransactionScroll((current) => Math.max(0, current - 1)); return; }
        if (key.downArrow) { setTransactionScroll((current) => Math.min(transactionMaxScroll, current + 1)); return; }
        if (key.pageUp) { setTransactionScroll((current) => Math.max(0, current - 5)); return; }
        if (key.pageDown) { setTransactionScroll((current) => Math.min(transactionMaxScroll, current + 5)); return; }
        if (key.home) { setTransactionScroll(0); return; }
        if (key.end) { setTransactionScroll(transactionMaxScroll); return; }
      }
      if (input === "i" || key.escape || (transaction.phase === "result" && key.return)) { closeTransaction(); return; }
      return;
    }
    if (overlay === "detail") {
      const tabs = inspectorModel ? detailedInfoTabs(inspectorModel) : [];
      if (key.leftArrow) { setDetailTabIndex((current) => Math.max(0, current - 1)); setDetailScroll(0); return; }
      if (key.rightArrow) { setDetailTabIndex((current) => Math.min(Math.max(0, tabs.length - 1), current + 1)); setDetailScroll(0); return; }
      if (key.upArrow) { setDetailScroll((current) => Math.max(0, current - 1)); return; }
      if (key.downArrow) { setDetailScroll((current) => Math.min(detailMaxScroll, current + 1)); return; }
      if (key.pageUp) { setDetailScroll((current) => Math.max(0, current - 5)); return; }
      if (key.pageDown) { setDetailScroll((current) => Math.min(detailMaxScroll, current + 5)); return; }
      if (key.home) { setDetailScroll(0); return; }
      if (key.end) { setDetailScroll(detailMaxScroll); return; }
      if (input === "i" || key.escape) { closeOverlay(); return; }
      return;
    }
    if (overlay === "settings") {
      if (settingsPickerOpen) {
        if (key.escape) { setSettingsPickerOpen(false); return; }
        if (key.upArrow || input === "k") { moveSettingsColorPicker(-1, 0); return; }
        if (key.downArrow || input === "j") { moveSettingsColorPicker(1, 0); return; }
        if (key.leftArrow || input === "h") { moveSettingsColorPicker(0, -1); return; }
        if (key.rightArrow || input === "l") { moveSettingsColorPicker(0, 1); return; }
        if (key.return) { chooseSettingsColor(); return; }
        return;
      }
      if (key.escape || input === ",") { closeOverlay(); return; }
      if (key.upArrow || input === "k") { setSettingsRoleIndex((current) => Math.max(0, current - 1)); return; }
      if (key.downArrow || input === "j") { setSettingsRoleIndex((current) => Math.min(workstationSemanticRoles.length - 1, current + 1)); return; }
      if (key.return) { openSettingsColorPicker(); return; }
      if (input === "s") { void applyAppearance(); return; }
      return;
    }
    if (overlay === "help") {
      if (input === "?" || key.escape) { closeOverlay(); return; }
      if (input === "i" && inspectorModel && ui.focusedWindow === "inspector") { setDetailTabIndex(0); setDetailScroll(0); setOverlay("detail"); return; }
      if (input === ",") { openSettings(); return; }
      return;
    }
    if (input === ",") { openSettings(); return; }
    if (input === "q") { onExit(); exit(); return; }
    if (input === "r") { void refreshNow(true); return; }
    if (input === "i" && ui.focusedWindow === "inspector") { openDetailedInfo(); return; }
    if (input === "?") { setOverlay("help"); return; }
    const numeric = Number.parseInt(input, 10);
    if (numeric >= 1 && numeric <= workstationDomains.length) { selectDomain(workstationDomains[numeric - 1]!.id); return; }
    if (key.tab) { setUi((current) => nextFocusedWindow(current, key.shift ? -1 : 1)); return; }
    if (key.escape) { if (ui.focusedWindow === "inspector") setUi((current) => setFocusedWindow(current, "inventory")); else if (ui.focusedWindow === "inventory" && ui.layout === "wide") setUi((current) => setFocusedWindow(current, "control")); return; }
    if (input === "n") {
      const create = contextActions.find((action) => action.key === "create");
      if (create) openAction(create);
      return;
    }
    if (ui.focusedWindow === "control") {
      if (key.upArrow || input === "k") { setUi((current) => moveDomain(current, -1)); setActionFocus(0); return; }
      if (key.downArrow || input === "j") { setUi((current) => moveDomain(current, 1)); setActionFocus(0); return; }
      if (key.return || key.rightArrow) { setUi((current) => moveFocusedWindowSpatial(current, 1)); return; }
      return;
    }
    if (ui.focusedWindow === "inventory") {
      if (key.upArrow || input === "k") { moveInventory(-1); return; }
      if (key.downArrow || input === "j") { moveInventory(1); return; }
      if (key.return || key.rightArrow) { setUi((current) => moveFocusedWindowSpatial(current, 1)); return; }
      if (key.leftArrow) { setUi((current) => moveFocusedWindowSpatial(current, -1)); return; }
      return;
    }
    const shortcut = contextActions.find((action) => action.shortcut === input);
    if (shortcut) { openAction(shortcut); return; }
    if (key.leftArrow) { setUi((current) => moveFocusedWindowSpatial(current, -1)); return; }
    if (key.upArrow) { setActionFocus(Math.max(0, actionIndexRef.current - 1)); return; }
    if (key.downArrow) { setActionFocus(Math.min(Math.max(0, contextActions.length - 1), actionIndexRef.current + 1)); return; }
    if (key.pageUp) { setActionFocus(Math.max(0, actionIndexRef.current - 5)); return; }
    if (key.pageDown) { setActionFocus(Math.min(Math.max(0, contextActions.length - 1), actionIndexRef.current + 5)); return; }
    if (key.home) { setActionFocus(0); return; }
    if (key.end) { setActionFocus(Math.max(0, contextActions.length - 1)); return; }
    if (key.return) { openAction(contextActions[Math.min(actionIndexRef.current, Math.max(0, contextActions.length - 1))]); return; }
  });

  if (layout === "too-small") return <Box flexDirection="column" width={terminal.width} height={terminal.height}><Text bold>Queqiao Workstation</Text><Box marginTop={1} flexDirection="column"><Text bold>Terminal too small</Text><Text>Workstation requires at least 60 columns ? 18 rows.</Text>{promptBridge.prompt ? <><Text bold color={palette.warning}>Form paused</Text><Text>Resize to continue. Esc cancels; other input is ignored.</Text></> : <Text dimColor>Resize the terminal; no runtime state has been changed.</Text>}</Box></Box>;

  const title = workstationDomains.find((entry) => entry.id === ui.domain)!.label;
  const headerState = busy ? "Working\u2026" : `${snapshot.runningGatewayCount + snapshot.runningWorkerCount}/${snapshot.gatewayCount + snapshot.workerCount} runtimes`;
  const actionFooter = promptBridge.prompt
    ? "Action form · input stays inside modal"
    : transaction?.phase === "running"
      ? "Action modal · Working\u2026"
      : transaction?.phase === "result"
        ? "Action result · ↑↓ scroll · Enter/Esc close"
        : overlay === "detail"
          ? "Detailed info · ←→ tabs · ↑↓ scroll · i/Esc close"
          : overlay === "settings"
            ? (settingsPickerOpen ? "Color picker · arrows move · Enter choose · Esc back" : "Settings · ↑↓ role · Enter colors · [s] save · Esc cancel")
            : overlay === "help"
              ? "Keyboard help · ?/Esc close"
              : actionFooterFor(snapshot, ui, entity, terminal.width);
  const navigationFooter = promptBridge.prompt ? "Enter apply/select · Esc cancel" : transaction?.phase === "result" ? "Modal owns input · ↑↓ scroll · Enter/Esc close" : transaction ? "Modal owns input" : overlay === "detail" ? "Modal owns input · ←→ tabs · ↑↓ scroll · i/Esc close" : overlay === "settings" ? (settingsPickerOpen ? "Modal owns input · arrows move · Enter choose · Esc back" : "Modal owns input · ↑↓ role · Enter colors · s save · Esc cancel") : overlay === "help" ? "Modal owns input · ?/Esc close" : navigationFooterFor(ui, terminal.width);
  const inspectorProps = { snapshot, state: ui, entity, model: inspectorModel, detailState, actionIndex, contextActions };
  return <WorkstationThemeProvider palette={palette}><Box position="relative" flexDirection="column" width={terminal.width} height={terminal.height} overflowY="hidden">
    <Box flexShrink={0} justifyContent="space-between"><Text bold color={palette.accent}>Queqiao Workstation</Text><Text><Text color={palette.accent}>{title}</Text> · {headerState}{verificationEnvironment ? <Text color={palette.warning}> · VERIFY</Text> : null}</Text></Box>
    <Box marginTop={1} flexGrow={1} flexShrink={1} minHeight={0}>
      {layout === "wide" ? <><ControlView snapshot={snapshot} state={ui} diagnostics={diagnosticsHealth} /><InventoryView snapshot={snapshot} state={ui} diagnostics={diagnosticsHealth} width={workstationGeometry.inventoryWideWidth} /><InspectorView {...inspectorProps} /></> : null}
      {layout === "standard" ? <><InventoryView snapshot={snapshot} state={ui} diagnostics={diagnosticsHealth} width={workstationGeometry.inventoryStandardWidth} compactDomains /><InspectorView {...inspectorProps} /></> : null}
      {layout === "narrow" && ui.focusedWindow === "inspector" ? <InspectorView {...inspectorProps} /> : null}
      {layout === "narrow" && ui.focusedWindow !== "inspector" ? <InventoryView snapshot={snapshot} state={ui} diagnostics={diagnosticsHealth} compactDomains /> : null}
    </Box>
    <Box marginTop={1} flexShrink={0}><Text bold color={statusColor(snapshot, busy, feedback, refreshWarning, diagnosticsHealth, palette)}>{statusText(snapshot, busy, feedback, refreshWarning, diagnosticsHealth, verificationEnvironment)}</Text></Box>
    <Box flexShrink={0}><Text>{actionFooter}</Text></Box>
    <Box flexShrink={0}><Text dimColor color={palette.muted}>{navigationFooter}</Text></Box>
    {transaction ? <WorkstationActionModal
      transaction={transaction}
      prompt={promptBridge.prompt}
      terminalWidth={terminal.width}
      terminalHeight={terminal.height}
      resultScrollOffset={transactionScroll}
      onResultScrollOffsetChange={setTransactionScroll}
      onResultMaxScrollOffsetChange={setTransactionMaxScroll}
    /> : null}
    {!transaction && overlay === "detail" && inspectorModel ? <WorkstationDetailedInfoModal
      model={inspectorModel}
      tabIndex={detailTabIndex}
      terminalWidth={terminal.width}
      terminalHeight={terminal.height}
      scrollOffset={detailScroll}
      onScrollOffsetChange={setDetailScroll}
      onMaxScrollOffsetChange={setDetailMaxScroll}
    /> : null}
    {!transaction && overlay === "help" ? <WorkstationHelpModal terminalWidth={terminal.width} terminalHeight={terminal.height} /> : null}
    {!transaction && overlay === "settings" ? <WorkstationSettingsModal selectedRoleIndex={settingsRoleIndex} colors={settingsColors} pickerOpen={settingsPickerOpen} pickerIndex={settingsPickerIndex} terminalWidth={terminal.width} terminalHeight={terminal.height} /> : null}
  </Box></WorkstationThemeProvider>;
}

export async function runInkWorkstationShell(snapshot: WorkstationSnapshot, refresh: () => Promise<WorkstationSnapshot>, executeDirect: (action: WorkstationDirectAction) => Promise<WorkstationDirectResult>, executeFlow: (action: WorkstationFlowAction, prompts: WorkstationPromptDriver) => Promise<WorkstationDirectResult>, loadInspectorDetail: (target: WorkstationInspectorTarget, snapshot: WorkstationSnapshot) => Promise<WorkstationInspectorDetail>): Promise<WorkstationShellResult> {
  let result: WorkstationShellResult = { type: "exit" };
  const settings = await loadWorkstationSettings().catch(() => ({ version: 1 as const, appearance: { colors: { ...DEFAULT_WORKSTATION_PALETTE } } }));
  const app = render(<WorkstationApp
    snapshot={snapshot}
    refresh={refresh}
    loadInspectorDetail={loadInspectorDetail}
    executeDirect={executeDirect}
    executeFlow={executeFlow}
    initialAppearance={settings.appearance.colors}
    saveAppearance={async (colors) => { await saveWorkstationSettings({ version: 1, appearance: { colors } }); }}
    onExit={() => { result = { type: "exit" }; }}
  />, workstationRenderOptions);
  await app.waitUntilExit();
  return result;
}

export const workstationUiInternals = { inventoryItems, actionItems, contextActionItems, emptyState, domainCount, runtimeGlyph, runtimeColor, feedbackColor, actionColor, snapshotsEqual, workstationPalette };
