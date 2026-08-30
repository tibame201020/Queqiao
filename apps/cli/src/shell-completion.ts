import { CLI_LEAF_CONTRACTS } from "./command-surface.js";

export type CompletionShell = "bash" | "zsh" | "powershell";

type CompletionModel = {
  candidatesByPrefix: Readonly<Record<string, readonly string[]>>;
  valueOptionsByRoute: Readonly<Record<string, readonly string[]>>;
};

const GLOBAL_LEAF_OPTIONS = ["--json", "--help", "-h"] as const;
const ROOT_OPTIONS = ["--version", "-v", "--help", "-h"] as const;

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

export function buildCompletionModel(): CompletionModel {
  const candidates = new Map<string, Set<string>>();
  const valueOptionsByRoute: Record<string, string[]> = {};
  const add = (prefix: string, candidate: string) => {
    const values = candidates.get(prefix) ?? new Set<string>();
    values.add(candidate);
    candidates.set(prefix, values);
  };

  for (const contract of CLI_LEAF_CONTRACTS) {
    const route = contract.route.split(" ");
    for (let index = 0; index < route.length; index += 1) {
      add(route.slice(0, index).join(" "), route[index]!);
    }
    const routeKey = route.join(" ");
    for (const option of contract.options) add(routeKey, `--${option}`);
    for (const value of contract.positionalValues ?? []) add(routeKey, value);
    for (const option of contract.handler === "completion" ? ["--help", "-h"] : GLOBAL_LEAF_OPTIONS) add(routeKey, option);
    valueOptionsByRoute[routeKey] = uniqueSorted((contract.valueOptions ?? []).map((option) => `--${option}`));
  }
  for (const option of ROOT_OPTIONS) add("", option);

  return {
    candidatesByPrefix: Object.fromEntries([...candidates].map(([prefix, values]) => [prefix, uniqueSorted(values)])),
    valueOptionsByRoute,
  };
}

function psQuote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function renderPowerShell(model: CompletionModel): string {
  const candidateEntries = Object.entries(model.candidatesByPrefix)
    .map(([prefix, values]) => `  ${psQuote(prefix)} = @(${values.map(psQuote).join(", ")})`)
    .join("\n");
  const valueEntries = Object.entries(model.valueOptionsByRoute)
    .filter(([, values]) => values.length)
    .map(([route, values]) => `  ${psQuote(route)} = @(${values.map(psQuote).join(", ")})`)
    .join("\n");
  return `# Queqiao PowerShell completion. Generated from CLI_LEAF_CONTRACTS.
$script:QueqiaoCompletionCandidates = @{
${candidateEntries}
}
$script:QueqiaoCompletionValueOptions = @{
${valueEntries}
}
Register-ArgumentCompleter -Native -CommandName queqiao,queqiao.cmd -ScriptBlock {
  param($wordToComplete, $commandAst, $cursorPosition)
  $elements = @($commandAst.CommandElements | ForEach-Object { $_.Extent.Text })
  $args = if ($elements.Count -gt 1) { @($elements[1..($elements.Count - 1)]) } else { @() }
  $currentIsElement = $args.Count -gt 0 -and $args[-1] -eq $wordToComplete
  $completed = if ($currentIsElement) { @($args[0..([Math]::Max(-1, $args.Count - 2))]) } else { $args }
  if ($completed.Count -eq 1 -and $args.Count -le 1 -and $currentIsElement) { $completed = @() }

  $routeParts = New-Object System.Collections.Generic.List[string]
  foreach ($token in $completed) {
    if ($token.StartsWith('-')) { break }
    $next = (@($routeParts) + $token) -join ' '
    if ($script:QueqiaoCompletionCandidates.ContainsKey($next) -or $script:QueqiaoCompletionValueOptions.ContainsKey($next)) {
      $routeParts.Add($token)
    } else { break }
  }
  $route = (@($routeParts) -join ' ')
  $previous = if ($completed.Count) { $completed[-1] } else { '' }
  $valueOptions = @($script:QueqiaoCompletionValueOptions[$route])
  if ($valueOptions -contains $previous) { return }
  $used = @($completed | Where-Object { $_.StartsWith('--') -or $_ -eq '-h' })
  foreach ($candidate in @($script:QueqiaoCompletionCandidates[$route])) {
    if ($candidate.StartsWith('-') -and $used -contains $candidate) { continue }
    if ($candidate -like "$wordToComplete*") {
      [System.Management.Automation.CompletionResult]::new($candidate, $candidate, 'ParameterValue', $candidate)
    }
  }
}
`;
}

function shSingleQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function renderBash(model: CompletionModel): string {
  const cases = Object.entries(model.candidatesByPrefix)
    .map(([prefix, values]) => `    ${shSingleQuote(prefix)}) candidates=${shSingleQuote(values.join(" "))} ;;`)
    .join("\n");
  const valueCases = Object.entries(model.valueOptionsByRoute)
    .filter(([, values]) => values.length)
    .map(([route, values]) => `    ${shSingleQuote(route)}) value_options=${shSingleQuote(values.join(" "))} ;;`)
    .join("\n");
  return `# Queqiao Bash completion. Generated from CLI_LEAF_CONTRACTS.
_queqiao_completion() {
  local cur prev route token candidates value_options used candidate
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev=""
  (( COMP_CWORD > 0 )) && prev="\${COMP_WORDS[COMP_CWORD-1]}"
  route=""
  local i
  for ((i=1; i<COMP_CWORD; i++)); do
    token="\${COMP_WORDS[i]}"
    [[ "$token" == -* ]] && break
    route="\${route:+$route }$token"
  done
  value_options=""
  case "$route" in
${valueCases}
  esac
  if [[ " $value_options " == *" $prev "* ]]; then
    COMPREPLY=()
    return 0
  fi
  candidates=""
  case "$route" in
${cases}
  esac
  used=" \${COMP_WORDS[*]:1:$COMP_CWORD} "
  COMPREPLY=()
  for candidate in $candidates; do
    [[ "$candidate" == -* && "$used" == *" $candidate "* ]] && continue
    [[ "$candidate" == "$cur"* ]] && COMPREPLY+=("$candidate")
  done
}
complete -o default -F _queqiao_completion queqiao
`;
}

function renderZsh(model: CompletionModel): string {
  const cases = Object.entries(model.candidatesByPrefix)
    .map(([prefix, values]) => `    ${shSingleQuote(prefix)}) candidates=(${values.map(shSingleQuote).join(" ")}) ;;`)
    .join("\n");
  const valueCases = Object.entries(model.valueOptionsByRoute)
    .filter(([, values]) => values.length)
    .map(([route, values]) => `    ${shSingleQuote(route)}) value_options=(${values.map(shSingleQuote).join(" ")}) ;;`)
    .join("\n");
  return `#compdef queqiao
# Queqiao Zsh completion. Generated from CLI_LEAF_CONTRACTS.
_queqiao_completion() {
  local cur prev route token candidate
  local -a candidates value_options used
  cur="$words[CURRENT]"
  prev="\${words[CURRENT-1]}"
  route=""
  local i
  for ((i=2; i<CURRENT; i++)); do
    token="$words[i]"
    [[ "$token" == -* ]] && break
    route="\${route:+$route }$token"
  done
  value_options=()
  case "$route" in
${valueCases}
  esac
  if (( \${value_options[(Ie)$prev]} )); then
    _files
    return
  fi
  candidates=()
  case "$route" in
${cases}
  esac
  used=(\${words[2,CURRENT-1]})
  local -a filtered
  filtered=()
  for candidate in $candidates; do
    if [[ "$candidate" == -* ]] && (( \${used[(Ie)$candidate]} )); then continue; fi
    [[ "$candidate" == \${cur}* ]] && filtered+=("$candidate")
  done
  compadd -- $filtered
}
compdef _queqiao_completion queqiao
`;
}

export function renderShellCompletion(shell: string): string {
  const model = buildCompletionModel();
  if (shell === "powershell") return renderPowerShell(model);
  if (shell === "bash") return renderBash(model);
  if (shell === "zsh") return renderZsh(model);
  throw new Error(`Unsupported shell "${shell}". Expected bash, zsh, or powershell.`);
}
