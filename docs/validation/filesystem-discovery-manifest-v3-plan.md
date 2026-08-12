# Manifest revision 3 ChatGPT validation plan

Revision 3 preserves the frozen seven-tool manifest in its original order and appends:

```text
list_directory
search_text
```

## Automated gate

- full clean build, typecheck, and test suite passes;
- directory output is deterministic and paginated;
- recursion, result counts, file sizes, and execution time are bounded;
- workspace traversal and symlink traversal are rejected or skipped;
- Gateway-to-Worker routing is exercised through MCP.

## ChatGPT acceptance

Using only the Revision 3 connector:

1. Confirm discovery exposes exactly the prior seven tools followed by the two new tools.
2. Call `list_directory` for a Windows workspace and confirm files and directories.
3. Call `search_text` for a known Windows repository string and confirm path and line.
4. Repeat both operations against a WSL workspace through the same connector.
5. Deny `search_text` for one workspace through the CLI and confirm execution is rejected.
6. Restore the permission without reconnecting and confirm the same call succeeds.

The revision is frozen only after this ChatGPT acceptance is recorded as evidence.
