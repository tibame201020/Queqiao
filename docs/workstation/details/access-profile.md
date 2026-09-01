# Access Profile Detailed Info

[Detailed Info index](README.md) · [繁體中文](access-profile.zh-TW.md)

![Access Profile Detailed Info final frame](../../assets/workstation/details/04-access-profile.png)

![Access Profile Detailed Info tabs](../../assets/workstation/details/04-access-profile.gif)

| Tab | What it shows |
| --- | --- |
| **Info** | profile name, built-in/custom type, and detached-template semantics |
| **Tools** | Tool allowlist captured by the profile |
| **Commands** | executable-command allowlist captured by the profile |

Built-in profiles are immutable. Custom profiles are reusable templates only: applying one copies authority into a Workspace and does not establish a live reference.

Custom profile mutations remain in Inspector actions: **Edit Profile**, **Rename Profile**, and **Delete Profile**; creation is available at the domain level.
