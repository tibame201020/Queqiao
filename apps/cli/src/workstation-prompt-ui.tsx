import { Box, Text, useBoxMetrics, type DOMElement, type Key } from "ink";
import { Children, useEffect, useMemo, useRef, useState } from "react";
import { WorkstationScrollViewport } from "./workstation-scroll.js";
import { useWorkstationPalette } from "./workstation-theme-ui.js";

function optionalPromptColor(color: string | undefined): { color?: string } {
  return color ? { color } : {};
}

function PromptSelectionViewport({ choices, index, children }: { choices: Array<{ description?: string }>; index: number; children: React.ReactNode }) {
  const [offset, setOffset] = useState(0);
  const focusedRef = useRef<DOMElement>(null);
  const focused = useBoxMetrics(focusedRef);
  useEffect(() => { setOffset(0); }, [choices]);
  const target = focused.hasMeasured ? { start: focused.top, height: focused.height } : undefined;
  return (
    <WorkstationScrollViewport offset={offset} {...(target ? { target } : {})} onOffsetChange={setOffset}>
      {Children.toArray(children).map((child, childIndex) => (
        <Box key={childIndex} flexDirection="column" {...(childIndex === index ? { ref: focusedRef } : {})}>{child}</Box>
      ))}
    </WorkstationScrollViewport>
  );
}

export type WorkstationPromptChoice = { value: string; label: string; description?: string };
export type WorkstationPromptMultiChoice = { value: string; label: string; description?: string; disabled?: boolean };
export type WorkstationPromptReview = {
  title?: string;
  tone?: "default" | "destructive";
  details?: string[];
};

export type WorkstationPromptDriver = {
  choose: (message: string, choices: WorkstationPromptChoice[]) => Promise<string>;
  multi: (message: string, choices: WorkstationPromptMultiChoice[], initialValues?: string[]) => Promise<string[]>;
  text: (message: string, initialValue?: string, validate?: (value: string) => string | undefined) => Promise<string>;
  secret: (message: string, initialValue?: string, validate?: (value: string) => string | undefined) => Promise<string>;
  confirm: (message: string, initialValue?: boolean, review?: WorkstationPromptReview) => Promise<boolean>;
};

type PromptState =
  | { kind: "choose"; message: string; choices: WorkstationPromptChoice[]; index: number }
  | { kind: "multi"; message: string; choices: WorkstationPromptMultiChoice[]; index: number; selected: string[] }
  | { kind: "text"; message: string; value: string; validate?: (value: string) => string | undefined; error?: string | undefined }
  | { kind: "secret"; message: string; value: string; validate?: (value: string) => string | undefined; error?: string | undefined }
  | { kind: "confirm"; message: string; value: boolean; review?: WorkstationPromptReview };

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void };

export class WorkstationPromptCancelledError extends Error {
  constructor() { super("Workstation action cancelled"); this.name = "WorkstationPromptCancelledError"; }
}

function move(current: number, delta: number, size: number): number {
  if (!size) return 0;
  return (current + delta + size) % size;
}

function popCharacter(value: string): string {
  const characters = Array.from(value);
  characters.pop();
  return characters.join("");
}

export function useWorkstationPromptBridge() {
  const [prompt, setPromptState] = useState<PromptState | undefined>();
  const promptRef = useRef<PromptState | undefined>(undefined);
  const pendingRef = useRef<Pending | undefined>(undefined);

  const setPrompt = (next: PromptState | undefined) => {
    promptRef.current = next;
    setPromptState(next);
  };

  const request = <T,>(next: PromptState): Promise<T> => {
    if (pendingRef.current) return Promise.reject(new Error("A Workstation prompt is already active"));
    setPrompt(next);
    return new Promise<T>((resolve, reject) => {
      pendingRef.current = { resolve: resolve as (value: unknown) => void, reject };
    });
  };

  const complete = (value: unknown) => {
    const pending = pendingRef.current;
    pendingRef.current = undefined;
    setPrompt(undefined);
    pending?.resolve(value);
  };

  const cancel = () => {
    const pending = pendingRef.current;
    pendingRef.current = undefined;
    setPrompt(undefined);
    pending?.reject(new WorkstationPromptCancelledError());
  };

  const driver = useMemo<WorkstationPromptDriver>(() => ({
    choose: (message, choices) => request<string>({ kind: "choose", message, choices, index: 0 }),
    multi: (message, choices, initialValues = []) => request<string[]>({ kind: "multi", message, choices, index: 0, selected: choices.filter((choice) => initialValues.includes(choice.value)).map((choice) => choice.value) }),
    text: (message, initialValue = "", validate) => request<string>({ kind: "text", message, value: initialValue, ...(validate ? { validate } : {}) }),
    secret: (message, initialValue = "", validate) => request<string>({ kind: "secret", message, value: initialValue, ...(validate ? { validate } : {}) }),
    confirm: (message, initialValue = false, review) => request<boolean>({ kind: "confirm", message, value: initialValue, ...(review ? { review } : {}) }),
  // request is stable for the lifetime of this hook because it only closes over refs/setState.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  const handleInput = (input: string, key: Key): boolean => {
    const current = promptRef.current;
    if (!current) return false;
    if (key.escape) { cancel(); return true; }

    if (current.kind === "choose") {
      if (key.upArrow || input === "k") setPrompt({ ...current, index: move(current.index, -1, current.choices.length) });
      else if (key.downArrow || input === "j") setPrompt({ ...current, index: move(current.index, 1, current.choices.length) });
      else if (key.return && current.choices[current.index]) complete(current.choices[current.index]!.value);
      return true;
    }

    if (current.kind === "multi") {
      if (key.upArrow || input === "k") setPrompt({ ...current, index: move(current.index, -1, current.choices.length) });
      else if (key.downArrow || input === "j") setPrompt({ ...current, index: move(current.index, 1, current.choices.length) });
      else if (input === " ") {
        const choice = current.choices[current.index];
        if (choice) {
          const isSelected = current.selected.includes(choice.value);
          if (choice.disabled && !isSelected) return true;
          const selected = isSelected
            ? current.selected.filter((value) => value !== choice.value)
            : [...current.selected, choice.value];
          setPrompt({ ...current, selected });
        }
      } else if (key.return) complete(current.choices.filter((choice) => current.selected.includes(choice.value)).map((choice) => choice.value));
      return true;
    }

    if (current.kind === "confirm") {
      if (input.toLowerCase() === "y") complete(true);
      else if (input.toLowerCase() === "n") complete(false);
      else if (key.leftArrow || key.rightArrow || key.upArrow || key.downArrow || input === "j" || input === "k") setPrompt({ ...current, value: !current.value });
      else if (key.return) complete(current.value);
      return true;
    }

    if (key.backspace || key.delete) {
      setPrompt({ ...current, value: popCharacter(current.value), error: undefined });
      return true;
    }
    if (key.return) {
      const value = current.value.trim();
      const error = current.validate?.(value);
      if (error) setPrompt({ ...current, error });
      else complete(value);
      return true;
    }
    if (!key.ctrl && !key.meta && !key.tab && !key.upArrow && !key.downArrow && !key.leftArrow && !key.rightArrow && input && input !== "\r" && input !== "\n") {
      setPrompt({ ...current, value: `${current.value}${input}`, error: undefined });
    }
    return true;
  };

  return { prompt, driver, handleInput, cancel };
}

function promptInstruction(prompt: PromptState): string {
  if (prompt.kind === "choose") return "Choose one option.";
  if (prompt.kind === "multi") return "Select one or more values.";
  if (prompt.kind === "secret") return "Enter a sensitive value. Input stays masked.";
  if (prompt.kind === "text") return "Enter the value to apply.";
  return prompt.review?.tone === "destructive" ? "Review the impact before confirming." : "Confirm this change.";
}

export function WorkstationPromptPanel({ prompt, targetTitle, compact = false }: { prompt: PromptState; targetTitle?: string; compact?: boolean }) {
  const promptPalette = useWorkstationPalette();
  const destructive = prompt.kind === "confirm" && prompt.review?.tone === "destructive";
  const heading = prompt.kind === "confirm" && prompt.review?.title ? prompt.review.title : prompt.message;
  const headingColor = destructive ? promptPalette.danger : promptPalette.accent;
  const reviewDetails = prompt.kind === "confirm" && prompt.review?.details
    ? prompt.review.details.filter((detail) => {
        if (!targetTitle) return true;
        const separator = detail.indexOf(":");
        if (separator < 0) return true;
        return detail.slice(separator + 1).trim() !== targetTitle;
      })
    : [];
  return (
    <Box flexDirection="column" flexGrow={1} flexShrink={1} minHeight={0} overflowY="hidden">
      <Box flexDirection="column" flexShrink={0}>
        <Text bold color={headingColor}>{heading}</Text>
        {prompt.kind === "confirm" && prompt.review?.title ? <Text>{prompt.message}</Text> : null}
        {prompt.kind !== "confirm" && !compact ? <Text dimColor color={promptPalette.muted}>{promptInstruction(prompt)}</Text> : null}
      </Box>
      {reviewDetails.length ? (
        <Box flexDirection="column" marginTop={1}>
          {reviewDetails.map((detail) => <Text key={detail} {...optionalPromptColor(destructive ? promptPalette.warning : undefined)}>  {detail}</Text>)}
        </Box>
      ) : null}
      {prompt.kind === "choose" ? (
        <Box flexDirection="column" marginTop={1} flexGrow={1} flexShrink={1} minHeight={0}>
          <Box flexDirection="column" flexGrow={1} flexShrink={1} minHeight={0}>
            <PromptSelectionViewport choices={prompt.choices} index={prompt.index}>
              {prompt.choices.map((choice, index) => (
                <Box key={choice.value} flexDirection="column">
                  <Text bold={index === prompt.index} {...optionalPromptColor(index === prompt.index ? promptPalette.accent : undefined)}>{index === prompt.index ? "› " : "  "}{choice.label}</Text>
                  {choice.description ? <Text dimColor color={promptPalette.muted}>    {choice.description}</Text> : null}
                </Box>
              ))}
            </PromptSelectionViewport>
          </Box>
          <Box flexShrink={0} marginTop={1}><Text dimColor color={promptPalette.muted}>↑↓/jk move · Enter select · Esc cancel</Text></Box>
        </Box>
      ) : null}
      {prompt.kind === "multi" ? (
        <Box flexDirection="column" marginTop={1} flexGrow={1} flexShrink={1} minHeight={0}>
          <Box flexDirection="column" flexGrow={1} flexShrink={1} minHeight={0}>
            <PromptSelectionViewport choices={prompt.choices} index={prompt.index}>
              {prompt.choices.map((choice, index) => {
                const selected = prompt.selected.includes(choice.value);
                const focused = index === prompt.index;
                return (
                  <Box key={choice.value} flexDirection="column">
                    <Text dimColor={Boolean(choice.disabled && !selected)} bold={focused || selected} {...optionalPromptColor(focused ? promptPalette.accent : selected ? promptPalette.success : undefined)}>{focused ? "› " : "  "}<Text color={selected ? promptPalette.success : promptPalette.muted}>[{selected ? "x" : " "}]</Text> {choice.label}{choice.disabled ? " ? unavailable" : ""}</Text>
                    {choice.description ? <Text dimColor color={promptPalette.muted}>      {choice.description}</Text> : null}
                  </Box>
                );
              })}
            </PromptSelectionViewport>
          </Box>
          <Box flexShrink={0} marginTop={1}><Text dimColor color={promptPalette.muted}>↑↓/jk move · Space toggle · Enter apply · Esc cancel</Text></Box>
        </Box>
      ) : null}
      {prompt.kind === "text" || prompt.kind === "secret" ? (
        <Box flexDirection="column" marginTop={1}>
          <Box borderStyle="single" borderColor={prompt.error ? promptPalette.danger : promptPalette.accent} paddingX={1}>
            <Text color={promptPalette.accent}>&gt; <Text>{prompt.kind === "secret" ? "•".repeat(Array.from(prompt.value).length) : prompt.value}</Text><Text backgroundColor={promptPalette.accent}> </Text></Text>
          </Box>
          {prompt.error ? <Text color={promptPalette.danger}>! {prompt.error}</Text> : null}
          <Text dimColor color={promptPalette.muted}>{prompt.kind === "secret" ? "Masked · " : ""}Type · Backspace · Enter apply · Esc cancel</Text>
        </Box>
      ) : null}
      {prompt.kind === "confirm" ? (
        <Box flexDirection="column" marginTop={1}>
          <Text>
            <Text bold={prompt.value} {...optionalPromptColor(prompt.value ? promptPalette.accent : undefined)}>{prompt.value ? "› " : "  "}Yes</Text>
            <Text>    </Text>
            <Text bold={!prompt.value} {...optionalPromptColor(!prompt.value ? promptPalette.accent : undefined)}>{!prompt.value ? "› " : "  "}No</Text>
          </Text>
          <Text dimColor color={promptPalette.muted}>{destructive ? "Default No · " : ""}y/n/arrows · Enter confirm · Esc cancel</Text>
        </Box>
      ) : null}
    </Box>
  );
}

export const workstationPromptUiInternals = { move, popCharacter };
