/** Bounded diagnostics for child-process acceptance failures.
 * Never return argv beyond the public command label, error.message, raw child output or paths.
 */
export function describePackagedCliFailure(args:readonly string[],error:unknown):string{
 const e=error&&typeof error==="object"?error as Record<string,unknown>:{};
 const command=/^[a-z][a-z-]{0,31}$/.test(args[0]??"")?args[0]:"unknown";
 const killed=e.killed===true;
 const code=typeof e.code==="number"&&Number.isSafeInteger(e.code)?String(e.code):"unknown";
 const kind=killed?"timeout":code!=="unknown"?"exit":"unknown";
 const signal=e.signal==="SIGTERM"?"SIGTERM":e.signal==="SIGKILL"?"SIGKILL":"none";
 const bytes=(v:unknown)=>typeof v==="string"?Buffer.byteLength(v):0;
 return `PACKAGED_CLI_FAILURE command=${command};kind=${kind};code=${code};signal=${signal};stdoutBytes=${bytes(e.stdout)};stderrBytes=${bytes(e.stderr)}`;
}
