import { createContext } from "react";
import type { DirectoryUser, Message } from "@ember/protocol";

export interface ProjectSelection {selected: ReadonlyMap<string, Message>; toggle: (message: Message) => void; active?: boolean; adopt?: (message: Message) => void; add?: (message: Message) => void}
export const ProjectChatContext = createContext<ProjectSelection | null>(null);
export const ProjectFeedbackNavigation = createContext<(() => void) | null>(null);

export const ProjectAssistantContext = createContext<{bot?: DirectoryUser; askPrivately: (message: Message) => void} | null>(null);
