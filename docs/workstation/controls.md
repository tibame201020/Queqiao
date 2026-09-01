# Workstation controls

**English** | [繁體中文](controls.zh-TW.md) · [Workstation index](README.md)

Each control below has its own recording from the packaged Workstation. The GIFs demonstrate navigation/inspection only; detailed field-by-field views are documented under [Detailed Info](details/README.md).

## 1. Gateways

![Gateways control](../assets/workstation/controls/01-gateways.gif)

Gateway is the public control plane. Inventory/Inspector expose lifecycle, public endpoint, service/management ports, health, and enrolled Worker count. Context actions include **Start/Stop**, **Configure**, **Copy MCP URL**, **Copy approval secret**, **Manage Workers**, **Create join code**, and **Remove Gateway**. Preconditions are enforced before execution; for example, join-code creation requires a running Gateway and removal requires it to be stopped.

## 2. Workers

![Workers control](../assets/workstation/controls/02-workers.gif)

Worker represents one native execution environment. Actions include **Start/Stop**, **Configure**, **Add Workspace**, **Join Gateway**, and **Remove Worker**. Setup creates the first Workspace together with the Worker. Enrollment stays Worker-side and requires the Worker runtime to be active.

## 3. Workspaces

![Workspaces control](../assets/workstation/controls/03-workspaces.gif)

A Workspace is the Worker-owned authority boundary for one filesystem root. **Edit Workspace** changes identity/copied access policy; **Remove Workspace** removes that authorized root. Exact duplicate roots are rejected while nested roots remain valid so narrower scopes can carry different authority. A configured Worker must retain at least one Workspace.

## 4. Access Profiles

![Access Profiles control](../assets/workstation/controls/04-access-profiles.gif)

Access Profiles are reusable Tool/command templates. Built-in Reader/Editor profiles are immutable; custom profiles can be created, edited, renamed, or deleted. Applying a profile copies its authority into a Workspace: later profile changes do not silently mutate existing Workspaces.

## 5. Extensions

![Extensions control](../assets/workstation/controls/05-extensions.gif)

Extensions are installed into the host Extension Hub, then explicitly attached/detached per Worker. Installation and attachment remain separate operations, so installing a package alone does not expand Worker/Workspace authority. Uninstall respects attachment constraints and uses destructive confirmation where required.

## 6. Diagnostics

![Diagnostics control](../assets/workstation/controls/06-diagnostics.gif)

Diagnostics runs Queqiao's authoritative health checks rather than a Workstation-only model. It covers local runtimes, Gateway routing to enrolled Workers, Extension Hub integrity, and remediation-oriented warnings. **Run diagnostics** is immediate and returns a structured result.

## 7. Settings / Appearance

![Appearance control](../assets/workstation/controls/07-settings-appearance.gif)

Press `,` anywhere to open Settings. Appearance edits the six semantic roles **Select/Focus**, **Active/Success**, **Warning**, **Danger/Error**, **Modal**, and **Muted** through the color picker. Saving changes presentation only; runtime authority and configuration are unaffected.

See [Appearance](appearance.md) for persistence and picker behavior.
