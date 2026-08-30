import { describe, expect, it } from "vitest";
import { CLI_LEAF_CONTRACTS } from "./command-surface.js";
import { buildCompletionModel, renderShellCompletion } from "./shell-completion.js";

describe("shell completion", () => {
  it("derives every command prefix and leaf option from the canonical CLI contracts", () => {
    const model = buildCompletionModel();
    for (const contract of CLI_LEAF_CONTRACTS) {
      const parts = contract.route.split(" ");
      for (let index = 0; index < parts.length; index += 1) {
        const prefix = parts.slice(0, index).join(" ");
        expect(model.candidatesByPrefix[prefix], `${contract.route} prefix ${prefix}`).toContain(parts[index]);
      }
      const leaf = model.candidatesByPrefix[contract.route] ?? [];
      for (const option of contract.options) expect(leaf, `${contract.route} --${option}`).toContain(`--${option}`);
      expect(leaf).toEqual(expect.arrayContaining(contract.handler === "completion" ? ["--help", "-h"] : ["--json", "--help", "-h"]));
    }
  });

  it("completes the Gateway info hierarchy and marks selector options as value-taking", () => {
    const model = buildCompletionModel();
    expect(model.candidatesByPrefix[""]).toEqual(expect.arrayContaining(["gateway", "worker", "extension", "completion", "--version", "-v"]));
    expect(model.candidatesByPrefix.gateway).toContain("info");
    expect(model.candidatesByPrefix.completion).toEqual(expect.arrayContaining(["bash", "zsh", "powershell"]));
    expect(model.candidatesByPrefix["gateway info"]).toEqual(expect.arrayContaining([
      "--gateway", "--detail", "--copy-url", "--copy-secret", "--json", "--help", "-h",
    ]));
    expect(model.valueOptionsByRoute["gateway info"]).toContain("--gateway");
  });

  it("renders native adapters for Bash, Zsh, and PowerShell", () => {
    const bash = renderShellCompletion("bash");
    const zsh = renderShellCompletion("zsh");
    const powershell = renderShellCompletion("powershell");
    expect(bash).toContain("complete -o default -F _queqiao_completion queqiao");
    expect(bash).toContain("'gateway info') candidates=");
    expect(zsh).toContain("#compdef queqiao");
    expect(zsh).toContain("compdef _queqiao_completion queqiao");
    expect(powershell).toContain("Register-ArgumentCompleter -Native -CommandName queqiao,queqiao.cmd");
    expect(powershell).toContain("'gateway info' = @(");
  });

  it("rejects unsupported shell names", () => {
    expect(() => renderShellCompletion("fish")).toThrow(/Expected bash, zsh, or powershell/);
  });
});
