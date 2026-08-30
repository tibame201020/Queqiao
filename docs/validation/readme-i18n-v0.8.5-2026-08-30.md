# README i18n validation - v0.8.5

Date: 2026-08-30

## Scope

This patch keeps the public CLI command spelling platform-neutral and adds a Traditional Chinese README without duplicating product behavior.

## Contract

- `queqiao` is the canonical documented executable on Windows, Linux, macOS, and WSL.
- Windows npm shims such as `queqiao.cmd` and `queqiao.ps1` are implementation details and are not used in product documentation.
- `README.md` is the English root README and links to `README.zh-TW.md`.
- `README.zh-TW.md` is a full Traditional Chinese counterpart and links back to English.
- Both READMEs contain the same onboarding command sequence and the same seven real PTY GIFs.
- `README.zh-TW.md` is included in the published npm package.

## Validation

- English README remains within the 180-line production guard.
- Traditional Chinese README is independently readable and does not embed the English document inline.
- No `queqiao.cmd` reference exists in either README.
- PowerShell, Bash, and Zsh completion examples all use canonical `queqiao`.
- CLI visual documentation regression tests validate language switching, package inclusion, command parity, and visual parity.
